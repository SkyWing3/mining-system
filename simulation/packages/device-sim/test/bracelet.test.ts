// Manilla virtual completa: sensores ambientales, alertas, enlace y central simulada.
import { describe, expect, it } from 'vitest'
import { FIXED_WIDTH_RASTERIZER, MESSAGES_PAGE, MonoFramebuffer, RecordingCanvas, VirtualBracelet, type EnvironmentSample, type FrameLogEntry } from '../src/index.ts'

const IDENTITY = { name: 'Manilla 07', minerName: 'Minero del gemelo', zone: 'Galería principal N1' }
const parse = (entry: FrameLogEntry) => JSON.parse(entry.text) as Record<string, unknown>

function bracelet(environment: EnvironmentSample, seed = 7): VirtualBracelet {
  return new VirtualBracelet({ environment: () => environment, identity: IDENTITY, seed })
}

describe('manilla virtual', () => {
  it('en aire limpio queda normal, LED verde y telemetría simulada cada 2 s', () => {
    const device = bracelet({ coPpm: 2, ambientC: 17, objectC: 18 })
    device.advance(30_000)
    expect(device.link()).toMatchObject({ configured: true, connected: true, identity: IDENTITY })
    expect(device.assessment().level).toBe('normal')
    expect(device.ledColor()).toBe('green')
    expect(device.ledBlink()).toBe(false)
    const telemetry = device.frames().filter(entry => entry.direction === 'tx' && entry.kind === 'telemetry')
    expect(telemetry.length).toBeGreaterThanOrEqual(13)
    for (const entry of telemetry) {
      const frame = parse(entry)
      expect(frame.simulated).toBe(true)
      expect(frame.level).toBe('normal')
      expect(Object.keys(frame)).toEqual(['type', 'temperatureC', 'objectTemperatureC', 'gasPpm', 'gasVoltage', 'level', 'simulated'])
    }
    const gaps = telemetry.slice(1).map((entry, index) => entry.atMs - telemetry[index].atMs)
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(2000)
    for (const gap of gaps) expect(gap).toBeLessThan(2100)
    // Cada trama recibe su ack con la hora de la central.
    const acks = device.frames().filter(entry => entry.direction === 'rx' && entry.kind === 'ack')
    expect(acks.length).toBeGreaterThanOrEqual(telemetry.length)
    // La central registró todas las lecturas (la última puede seguir en viaje).
    expect(device.centralView().telemetry).toBeGreaterThanOrEqual(telemetry.length - 1)
    expect(device.centralView().telemetry).toBeLessThanOrEqual(telemetry.length)
  })

  it('con 260 ppm pasa a peligro tras las muestras de confirmación y envía CO_ALARM', () => {
    const device = bracelet({ coPpm: 260, ambientC: 24, objectC: 26 })
    device.advance(1500)
    // Muestras en 0 s y 1 s: todavía sin confirmar.
    expect(device.assessment().level).toBe('normal')
    device.advance(1000)
    expect(device.assessment().level).toBe('danger')
    expect(device.ledColor()).toBe('red')
    expect(device.ledBlink()).toBe(true)
    expect(device.menuState().alarmVisible).toBe(true)
    // Buzzer intermitente 400/400 ms.
    const buzzer: boolean[] = []
    for (let i = 0; i < 8; i++) {
      device.advance(100)
      buzzer.push(device.outputs().buzzer)
    }
    expect(buzzer).toContain(true)
    expect(buzzer).toContain(false)
    device.advance(2000)
    const alarm = device.frames().find(entry => entry.direction === 'tx' && entry.kind === 'message')
    expect(alarm).toBeDefined()
    const frame = parse(alarm as FrameLogEntry)
    expect(frame.code).toBe('CO_ALARM')
    expect(frame.detail).toMatch(/^CO \d+ ppm \(simulado\)$/)
    expect(frame.clientMessageId).toMatch(/^[0-9a-f]{32}$/)
    expect(typeof frame.sentAt).toBe('string')
    const ack = device.frames().find(entry => entry.direction === 'rx' && entry.kind === 'ack' && parse(entry).clientMessageId === frame.clientMessageId)
    expect(ack).toBeDefined()
    expect(device.pending().messages).toBe(0)
    expect(device.centralView().messages.map(message => message.code)).toEqual(['CO_ALARM'])
    // La OLED muestra la superposición de peligro y Enter la silencia.
    const canvas = new RecordingCanvas()
    device.render(canvas)
    expect(canvas.hasText('PELIGRO')).toBe(true)
    device.press('enter')
    device.advance(10)
    expect(device.outputs().buzzer).toBe(false)
    expect(device.ledColor()).toBe('red')
  })

  it('la misma semilla produce el mismo registro de tramas', () => {
    const run = () => {
      const device = bracelet({ coPpm: 60, ambientC: 29, objectC: 31 }, 42)
      device.advance(12_000)
      device.press('down')
      device.press('down')
      device.press('down')
      device.press('enter')
      device.press('enter')
      device.press('enter')
      device.advance(8_000)
      return device.frames().map(entry => `${entry.atMs} ${entry.direction} ${entry.text}`)
    }
    const first = run()
    expect(first.length).toBeGreaterThan(10)
    expect(run()).toEqual(first)
  })

  it('sin central guarda los mensajes y los entrega al reconectar', () => {
    const device = bracelet({ coPpm: 3, ambientC: 18, objectC: 19 })
    device.advance(3000)
    device.setCentralOnline(false)
    device.advance(500)
    expect(device.link().connected).toBe(false)
    expect(device.ledColor()).toBe('blue')
    const before = device.framesVersion()
    // Mensaje «Ayuda» desde el menú mientras no hay enlace.
    for (let i = 0; i < MESSAGES_PAGE; i++) device.press('down')
    device.press('enter')
    device.press('enter')
    device.press('enter')
    expect(device.menuState().deliveryStatus).toBe('Guardado en cola')
    device.advance(30_000)
    expect(device.pending().messages).toBe(1)
    expect(device.framesVersion()).toBe(before)
    device.setCentralOnline(true)
    device.advance(25_000)
    expect(device.link().connected).toBe(true)
    expect(device.pending().messages).toBe(0)
    expect(device.menuState().deliveryStatus).toBe('Enviado a central')
    expect(device.centralView().messages.map(message => message.code)).toEqual(['HELP'])
  })

  it('un aviso de la central se muestra, se confirma como entregado y leído', () => {
    const device = bracelet({ coPpm: 3, ambientC: 18, objectC: 19 })
    device.advance(3000)
    device.sendNotice('EVACUATE')
    device.advance(500)
    expect(device.ledColor()).toBe('blue')
    expect(device.ledBlink()).toBe(true)
    const canvas = new RecordingCanvas()
    device.render(canvas)
    expect(canvas.hasText('AVISO URGENTE')).toBe(true)
    expect(canvas.hasText('Evacuar ahora')).toBe(true)
    device.press('enter')
    device.advance(3000)
    const stages = device.frames().filter(entry => entry.kind === 'notice-ack').map(entry => parse(entry).stage)
    expect(stages).toEqual(['delivered', 'read'])
    expect(device.centralView().notices[0].status).toBe('read')
    expect(device.ledColor()).toBe('green')
  })

  it('el mensaje de voz simulado se sube a la central', () => {
    const device = bracelet({ coPpm: 3, ambientC: 18, objectC: 19 })
    device.advance(3000)
    for (let i = 0; i < 4; i++) device.press('down')
    device.press('enter')
    device.press('enter')
    device.advance(4200)
    device.press('enter')
    expect(device.menuState().voiceMode).toBe('confirm')
    device.press('enter')
    expect(device.menuState().voiceStatus).toBe('Guardado en cola')
    device.advance(2000)
    expect(device.menuState().voiceStatus).toBe('Enviado a central')
    expect(device.centralView().voices).toHaveLength(1)
    expect(device.frames().some(entry => entry.kind === 'voice' && entry.text.includes('sin audio'))).toBe(true)
  })

  it('sin calibración envía solo la tensión y el CO no dispara alarmas', () => {
    const device = bracelet({ coPpm: 400, ambientC: 18, objectC: 19 })
    device.setCalibrated(false)
    device.advance(10_000)
    expect(device.assessment().level).toBe('normal')
    const telemetry = device.frames().filter(entry => entry.kind === 'telemetry').map(parse)
    expect(telemetry.length).toBeGreaterThan(2)
    for (const frame of telemetry) {
      expect(frame.gasPpm).toBeUndefined()
      expect(frame.gasVoltage as number).toBeGreaterThan(0.6)
    }
  })

  it('dibuja la OLED en una memoria de imagen de 128x64', () => {
    const device = bracelet({ coPpm: 3, ambientC: 18, objectC: 19 })
    device.advance(3000)
    const buffer = new MonoFramebuffer(FIXED_WIDTH_RASTERIZER)
    device.render(buffer)
    const version = buffer.version
    expect(buffer.litCount()).toBeGreaterThan(200)
    device.press('down')
    device.render(buffer)
    expect(buffer.version).toBe(version + 1)
  })
})
