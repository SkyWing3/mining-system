// Protocolo con la central sobre un WebSocket ya abierto (link_session.cpp).
//
// Mantiene una sola solicitud en vuelo (telemetría, heartbeat o una entrada de la
// cola) y separa las respuestas `ack`/`error` de los avisos que la central envía
// por iniciativa propia. Las entradas de la cola solo se borran tras el `ack` que
// les corresponde. No depende del transporte: recibe lo que llega por el socket y
// una función para enviar.
import { transportEvent, type EventQueue, type Identity, type TransportKind } from './events.ts'
import { prepareFrame, type Outbox, type OutboxEntry } from './outbox.ts'
import { telemetryFrame, type TelemetryReading } from './sensors.ts'
import { parseIso, type WallClock } from './wallclock.ts'

export interface LinkTiming {
  heartbeatMs: number
  telemetryMs: number
  responseTimeoutMs: number
  /** Los mensajes que esperan una asignación (o una falla temporal) se reintentan a este ritmo. */
  blockedRetryMs: number
}

export const DEFAULT_LINK_TIMING: LinkTiming = { heartbeatMs: 20000, telemetryMs: 2000, responseTimeoutMs: 10000, blockedRetryMs: 10000 }

const HEARTBEAT = '{"type":"heartbeat"}'

type Pending = 'none' | 'heartbeat' | 'telemetry' | 'entry'

type Json = Record<string, unknown>

const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback)

export class LinkSession {
  private readonly timing: LinkTiming
  private readonly outbox: Outbox
  private readonly clock: WallClock
  private readonly events: EventQueue
  private readonly telemetry: (() => TelemetryReading | null) | null
  private send: ((frame: string) => boolean) | null = null
  private isOpen = false
  private isConnected = false
  private hasFailed = false
  private failureReason = ''
  private pending: Pending = 'none'
  private pendingSince = 0
  private pendingEntry: OutboxEntry | null = null
  private nextTelemetry = 0
  private nextHeartbeat = 0
  private blockedUntil = 0
  private outboxRetryAt = 0
  /** Avisos del registro del firmware (LOG_W), útiles para el diagnóstico del gemelo. */
  readonly warnings: string[] = []

  constructor(timing: LinkTiming, outbox: Outbox, clock: WallClock, events: EventQueue, telemetry: (() => TelemetryReading | null) | null) {
    this.timing = timing
    this.outbox = outbox
    this.clock = clock
    this.events = events
    this.telemetry = telemetry
  }

  open(): boolean { return this.isOpen }
  /** Verdadero después del primer ack de la sesión. */
  connected(): boolean { return this.isConnected }
  /** La sesión debe descartarse (tiempo agotado, respuesta inválida...): quien la usa cierra el socket. */
  failed(): boolean { return this.hasFailed }
  failure(): string { return this.failureReason }

  /** Se abrió el socket: la sesión empieza con un heartbeat y espera su ack. */
  opened(now: number, send: (frame: string) => boolean): void {
    this.send = send
    this.isOpen = true
    this.isConnected = false
    this.hasFailed = false
    this.failureReason = ''
    this.pending = 'none'
    this.outboxRetryAt = 0
    this.request(HEARTBEAT, 'heartbeat', now)
  }

  /** Se cerró el socket o no se pudo abrir. */
  closed(detail: string): void {
    this.isOpen = false
    this.isConnected = false
    this.pending = 'none'
    this.send = null
    this.events.push({ type: 'transport', event: transportEvent('disconnected', '', detail) })
  }

  /** Envía la siguiente trama si no hay nada en vuelo y detecta respuestas vencidas. */
  poll(now: number): void {
    if (!this.isOpen || this.hasFailed) return
    if (this.pending !== 'none') {
      if (now - this.pendingSince >= this.timing.responseTimeoutMs) this.fail('La central no respondió a tiempo')
      return
    }
    if (!this.isConnected) return
    // La telemetría en vivo sigue fluyendo aunque se esté vaciando una cola larga.
    if (now >= this.nextTelemetry) {
      this.nextTelemetry = now + this.timing.telemetryMs
      const reading = this.telemetry ? this.telemetry() : null
      if (reading) {
        this.nextHeartbeat = now + this.timing.heartbeatMs
        this.request(telemetryFrame(reading), 'telemetry', now)
        return
      }
    }
    if (now >= this.nextHeartbeat) {
      this.nextHeartbeat = now + this.timing.heartbeatMs
      this.request(HEARTBEAT, 'heartbeat', now)
      return
    }
    if (now < this.outboxRetryAt) return
    const entry = this.outbox.first(now < this.blockedUntil)
    if (!entry) return
    const frame = prepareFrame(entry.frame, this.clock)
    if (frame === null) {
      // Sin la hora de la central la entrada espera.
      this.outboxRetryAt = now + 1000
      return
    }
    this.pendingEntry = entry
    this.request(frame, 'entry', now)
  }

  received(raw: string, now: number): void {
    let frame: Json
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('no es un objeto')
      frame = parsed as Json
    } catch {
      this.warnings.push('Trama inválida de la central')
      return
    }
    const type = text(frame.type, '')
    if (type === 'notice') {
      this.notice(frame)
      return
    }
    if (this.pending === 'none') return
    const kind = this.pending
    this.pending = 'none'
    if (type === 'error') this.handleError(kind, text(frame.code, 'unavailable'), text(frame.message, 'Error de la central'), now)
    else if (type === 'ack') this.handleAck(kind, frame, now)
    else this.fail('Respuesta inválida de la central')
    if (!this.hasFailed) this.poll(now)
  }

  private fail(reason: string): void {
    if (this.hasFailed) return
    this.hasFailed = true
    this.failureReason = reason
    this.warnings.push(`Enlace con la central interrumpido: ${reason}`)
  }

  private request(frame: string, kind: Pending, now: number): void {
    if (!this.send || !this.send(frame)) {
      this.fail('No se pudo enviar la trama')
      return
    }
    this.pending = kind
    this.pendingSince = now
  }

  private push(kind: TransportKind, messageId = '', detail = '', identity: Identity | null = null): void {
    this.events.push({ type: 'transport', event: transportEvent(kind, messageId, detail, identity) })
  }

  private handleAck(kind: Pending, frame: Json, now: number): void {
    if (typeof frame.serverTime === 'string') {
      const serverTime = parseIso(frame.serverTime)
      if (serverTime !== null) this.clock.sync(serverTime)
    }
    switch (kind) {
      case 'heartbeat':
        if (!this.isConnected) {
          this.isConnected = true
          this.push('connected')
          const device = frame.device
          if (typeof device === 'object' && device !== null && !Array.isArray(device)) {
            const value = device as Json
            this.push('identity', '', '', { name: text(value.name, ''), minerName: typeof value.minerName === 'string' ? value.minerName : null, zone: text(value.zone, '') })
          }
          this.nextTelemetry = this.telemetry ? now + this.timing.telemetryMs : Number.POSITIVE_INFINITY
          this.nextHeartbeat = now + this.timing.heartbeatMs
        }
        break
      case 'telemetry':
        break
      case 'entry': {
        const entry = this.pendingEntry
        if (!entry) break
        const message = entry.type === 'message'
        const messageId = typeof frame.messageId === 'number' ? frame.messageId : 0
        if (message && (text(frame.clientMessageId, '') !== entry.id || !messageId)) {
          this.fail('La confirmación no corresponde al mensaje')
          return
        }
        this.outbox.acknowledge(entry.id)
        this.blockedUntil = 0
        if (message) this.push('delivered', entry.id)
        break
      }
      case 'none':
        break
    }
  }

  private handleError(kind: Pending, code: string, message: string, now: number): void {
    switch (kind) {
      case 'heartbeat':
        this.fail(message)
        break
      case 'telemetry':
        // Una lectura rechazada se descarta; nunca debe bloquear el enlace.
        this.warnings.push(`La central rechazó una lectura: ${message}`)
        break
      case 'entry': {
        const entry = this.pendingEntry
        if (!entry) break
        if (code === 'invalid') {
          this.outbox.reject(entry.id, message)
          this.push('rejected', entry.id, message)
        } else {
          // Manilla sin asignar o falla temporal: se conserva la entrada y se reintenta.
          this.blockedUntil = now + this.timing.blockedRetryMs
          this.push('blocked', entry.id, message)
        }
        break
      }
      case 'none':
        break
    }
  }

  private notice(frame: Json): void {
    const noticeId = frame.noticeId
    if (typeof noticeId !== 'number' || !Number.isInteger(noticeId)) return
    // Un aviso que el minero ya confirmó sin enlace no se vuelve a mostrar.
    if (this.outbox.hasNoticeAck(noticeId, 'read')) return
    if (!this.outbox.hasNoticeAck(noticeId, 'delivered')) {
      const error = this.outbox.enqueueNoticeAck(noticeId, 'delivered')
      if (error) this.warnings.push(`No se pudo guardar la entrega del aviso: ${error}`)
    }
    this.events.push({
      type: 'notice',
      notice: { noticeId, code: text(frame.code, ''), text: text(frame.text, ''), severity: text(frame.severity, 'info') },
    })
  }
}
