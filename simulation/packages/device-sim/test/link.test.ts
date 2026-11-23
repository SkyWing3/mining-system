// Protocolo con la central (port de esp32-device/test/test_link).
import { describe, expect, it } from 'vitest'
import { DEFAULT_LINK_TIMING, EventQueue, formatIso, LinkSession, Outbox, WallClock, type Event, type TelemetryReading, type TransportKind } from '../src/index.ts'
import { Counter, FakeClock } from './fakes.ts'

const SERVER_TIME = '2026-11-16T19:04:05.1234567Z'

class Harness {
  readonly random = new Counter()
  readonly clock = new FakeClock()
  readonly wall = new WallClock(1, this.clock.fn)
  readonly outbox = new Outbox(this.random.fn)
  readonly events = new EventQueue(100)
  reading: TelemetryReading | null = null
  readonly session = new LinkSession(DEFAULT_LINK_TIMING, this.outbox, this.wall, this.events, () => this.reading)
  readonly sent: string[] = []
  sendFails = false

  open(): void {
    this.session.opened(this.clock.now, frame => {
      if (this.sendFails) return false
      this.sent.push(frame)
      return true
    })
  }

  last(): Record<string, unknown> {
    return JSON.parse(this.sent[this.sent.length - 1]) as Record<string, unknown>
  }

  reply(json: string): void {
    this.session.received(json, this.clock.now)
  }

  ack(extra = ''): void {
    this.reply(`{"type":"ack","serverTime":"${SERVER_TIME}"${extra ? `,${extra}` : ''}}`)
  }

  drain(): Event[] {
    const result: Event[] = []
    for (let event = this.events.pop(); event; event = this.events.pop()) result.push(event)
    return result
  }

  transportKinds(): TransportKind[] {
    return this.drain().flatMap(event => (event.type === 'transport' ? [event.event.kind] : []))
  }

  handshake(): void {
    this.open()
    this.ack('"device":{"name":"Manilla 01","minerName":"Javier Mamani","zone":"Galería norte"}')
  }

  enqueue(code: string, absolute = false): string {
    const stamp = absolute ? this.wall.stamp() : { epochMs: -1, boot: 1, uptimeMs: 0 }
    const result = this.outbox.enqueueMessage(code, null, stamp)
    if (!('id' in result)) throw new Error(result.error)
    return result.id
  }
}

describe('enlace con la central', () => {
  it('el handshake informa la identidad y sincroniza el reloj', () => {
    const h = new Harness()
    h.open()
    expect(h.sent).toHaveLength(1)
    expect(h.last().type).toBe('heartbeat')
    expect(h.session.connected()).toBe(false)
    h.ack('"device":{"name":"Manilla 01","minerName":null,"zone":"Galería norte"}')
    expect(h.session.connected()).toBe(true)
    expect(h.wall.synced()).toBe(true)
    expect(formatIso(h.wall.now() ?? 0)).toBe('2026-11-16T19:04:05.123Z')
    const events = h.drain()
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: 'transport', event: { kind: 'connected' } })
    expect(events[1]).toMatchObject({ type: 'transport', event: { kind: 'identity', identity: { name: 'Manilla 01', minerName: null, zone: 'Galería norte' } } })
  })

  it('entrega la cola en orden, de a una', () => {
    const h = new Harness()
    const first = h.enqueue('HELP')
    const second = h.enqueue('OK')
    h.handshake()
    h.drain()
    // Justo después del ack del handshake sale la primera entrada, fechada con la hora de la central.
    expect(h.sent).toHaveLength(2)
    const frame = h.last()
    expect(frame.clientMessageId).toBe(first)
    expect(typeof frame.sentAt).toBe('string')
    expect(frame._boot).toBeUndefined()
    // Nada más sale mientras está en vuelo.
    h.session.poll(h.clock.now)
    expect(h.sent).toHaveLength(2)
    h.ack(`"clientMessageId":"${first}","messageId":41`)
    expect(h.outbox.pending()).toBe(1)
    expect(h.last().clientMessageId).toBe(second)
    h.ack(`"clientMessageId":"${second}","messageId":42`)
    expect(h.outbox.pending()).toBe(0)
    const kinds = h.transportKinds()
    expect(kinds).toEqual(['delivered', 'delivered'])
  })

  it('un ack que no corresponde conserva el mensaje', () => {
    const h = new Harness()
    h.handshake()
    h.enqueue('HELP', true)
    h.session.poll(h.clock.now)
    h.ack('"clientMessageId":"otro","messageId":41')
    expect(h.session.failed()).toBe(true)
    expect(h.outbox.pending()).toBe(1)
    h.session.closed('cerrado')
    expect(h.session.open()).toBe(false)
    expect(h.transportKinds().at(-1)).toBe('disconnected')
  })

  it('una trama inválida se rechaza y una manilla sin asignar se conserva', () => {
    const h = new Harness()
    h.handshake()
    h.drain()
    const bad = h.enqueue('HELP', true)
    const kept = h.enqueue('OK', true)
    h.session.poll(h.clock.now)
    h.reply('{"type":"error","code":"invalid","message":"Mensaje fuera del catálogo."}')
    expect(h.outbox.pending()).toBe(1)
    // La siguiente entrada sale de inmediato y la central no tiene minero asignado.
    expect(h.last().clientMessageId).toBe(kept)
    h.reply('{"type":"error","code":"unassigned","message":"La manilla necesita un minero asignado."}')
    expect(h.session.failed()).toBe(false)
    expect(h.outbox.pending()).toBe(1)
    const events = h.drain()
    expect(events[0]).toMatchObject({ type: 'transport', event: { kind: 'rejected', messageId: bad } })
    expect(events[1]).toMatchObject({ type: 'transport', event: { kind: 'blocked' } })
    // Mientras está bloqueada, los mensajes esperan...
    let sent = h.sent.length
    h.session.poll(h.clock.now)
    expect(h.sent).toHaveLength(sent)
    // ...pero las confirmaciones de avisos sí salen.
    h.outbox.enqueueNoticeAck(5, 'read')
    h.session.poll(h.clock.now)
    expect(h.sent).toHaveLength(sent + 1)
    expect(h.last().type).toBe('notice-ack')
    // Cualquier entrega confirmada levanta el bloqueo y el mensaje se reintenta.
    h.ack()
    expect(h.last().clientMessageId).toBe(kept)
    h.reply('{"type":"error","code":"unassigned","message":"La manilla necesita un minero asignado."}')
    sent = h.sent.length
    h.clock.now += 9999
    h.session.poll(h.clock.now)
    expect(h.sent).toHaveLength(sent)
    h.clock.now += 1
    h.session.poll(h.clock.now)
    expect(h.last().clientMessageId).toBe(kept)
  })

  it('envía la telemetría en vivo periódicamente', () => {
    const h = new Harness()
    h.reading = { temperatureC: 24.5, objectTemperatureC: 26.123456, gasPpm: null, gasVoltage: 0.4123, level: 'caution', simulated: false }
    h.handshake()
    const sent = h.sent.length
    h.clock.now += 1999
    h.session.poll(h.clock.now)
    expect(h.sent).toHaveLength(sent)
    h.clock.now += 1
    h.session.poll(h.clock.now)
    const frame = h.last()
    expect(frame.type).toBe('telemetry')
    expect(frame.temperatureC).toBe(24.5)
    expect(frame.objectTemperatureC as number).toBeCloseTo(26.123456, 4)
    expect(frame.gasPpm).toBeUndefined()
    expect(frame.level).toBe('caution')
    expect(frame.simulated).toBe(false)
    // Una lectura rechazada nunca bloquea el enlace.
    h.reply('{"type":"error","code":"invalid","message":"Lectura inválida"}')
    expect(h.session.failed()).toBe(false)
    // Sin lecturas, el enlace vuelve a los heartbeats.
    h.reading = null
    h.clock.now += 20000
    h.session.poll(h.clock.now)
    expect(h.last().type).toBe('heartbeat')
  })

  it('un aviso empujado se muestra y se confirma', () => {
    const h = new Harness()
    h.handshake()
    h.drain()
    h.reply('{"type":"notice","noticeId":12,"code":"EVACUATE","text":"Evacuar ahora","severity":"critical"}')
    let events = h.drain()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'notice', notice: { noticeId: 12, text: 'Evacuar ahora', severity: 'critical' } })
    expect(h.outbox.hasNoticeAck(12, 'delivered')).toBe(true)
    // Reenviado al reconectar: sin confirmación duplicada.
    h.reply('{"type":"notice","noticeId":12,"code":"EVACUATE","text":"Evacuar ahora"}')
    expect(h.outbox.pending()).toBe(1)
    // Leído sin enlace: no se vuelve a mostrar.
    h.outbox.enqueueNoticeAck(13, 'read')
    h.reply('{"type":"notice","noticeId":13,"text":"Ya leído"}')
    h.reply('{"type":"notice","noticeId":true}')
    events = h.drain()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'notice', notice: { noticeId: 12 } })
  })

  it('tiempos agotados y errores descartan la sesión', () => {
    const h = new Harness()
    h.open()
    h.clock.now += 9999
    h.session.poll(h.clock.now)
    expect(h.session.failed()).toBe(false)
    h.clock.now += 1
    h.session.poll(h.clock.now)
    expect(h.session.failed()).toBe(true)

    const unauthorized = new Harness()
    unauthorized.open()
    unauthorized.reply('{"type":"error","code":"unauthorized","message":"Credencial inválida"}')
    expect(unauthorized.session.failed()).toBe(true)
    expect(unauthorized.session.connected()).toBe(false)

    const garbage = new Harness()
    garbage.open()
    garbage.reply('no es json')
    expect(garbage.session.failed()).toBe(false)
    garbage.reply('{"type":"pong"}')
    expect(garbage.session.failed()).toBe(true)

    const broken = new Harness()
    broken.sendFails = true
    broken.open()
    expect(broken.session.failed()).toBe(true)
  })
})
