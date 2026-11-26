// Cobertura Wi-Fi limitada: estación del ESP32, retransmisiones TCP y lo que hace la
// manilla sin señal (cola durable, reintentos y entrega al recuperar la cobertura).
import { describe, expect, it } from 'vitest'
import { parseIso, PRESENCE_WINDOW_MS, segmentLoss, VirtualBracelet, WifiStation, type AccessPointSignal, type EnvironmentSample } from '../src/index.ts'

const IDENTITY = { name: 'Manilla 07', minerName: 'Minero del gemelo', zone: 'Galería principal N1' }

/** Radio controlable desde la prueba: lo que «recibe» la manilla en cada instante. */
function radio(initial: AccessPointSignal[]) {
  let signals = initial
  return {
    scan: () => signals,
    set(next: AccessPointSignal[]) { signals = next },
  }
}

function bracelet(environment: () => EnvironmentSample, scan: () => readonly AccessPointSignal[], seed = 11): VirtualBracelet {
  return new VirtualBracelet({ environment, identity: IDENTITY, seed, radio: scan })
}

const CLEAN: EnvironmentSample = { coPpm: 2, ambientC: 18, objectC: 19 }

describe('estación Wi-Fi', () => {
  it('se asocia al punto de acceso más fuerte que supere el mínimo y tarda en hacerlo', () => {
    const air = radio([{ id: 'AP-02', rssi: -60 }, { id: 'AP-01', rssi: -72 }])
    const station = new WifiStation(air.scan)
    station.update(0)
    expect(station.status()).toMatchObject({ state: 'connecting', accessPoint: 'AP-02' })
    station.update(1000)
    expect(station.connected()).toBe(false)
    station.update(2300)
    expect(station.connected()).toBe(true)
  })

  it('no se asocia con señal por debajo del mínimo', () => {
    const station = new WifiStation(() => [{ id: 'AP-09', rssi: -88 }])
    for (let t = 0; t < 20_000; t += 100) station.update(t)
    expect(station.status().state).toBe('disconnected')
  })

  it('se queda con su punto de acceso aunque otro sea mejor y cambia solo al perder las balizas', () => {
    const air = radio([{ id: 'AP-01', rssi: -55 }])
    const station = new WifiStation(air.scan)
    for (let t = 0; t <= 3000; t += 100) station.update(t)
    expect(station.status().accessPoint).toBe('AP-01')
    // AP-02 mucho mejor, AP-01 débil pero con balizas: sin itinerancia.
    air.set([{ id: 'AP-02', rssi: -50 }, { id: 'AP-01', rssi: -86 }])
    for (let t = 3100; t <= 20_000; t += 100) station.update(t)
    expect(station.status()).toMatchObject({ state: 'connected', accessPoint: 'AP-01' })
    // AP-01 deja de oírse: tras 6 s sin balizas se desasocia y vuelve a buscar.
    air.set([{ id: 'AP-02', rssi: -50 }])
    for (let t = 20_100; t <= 25_900; t += 100) station.update(t)
    expect(station.status().accessPoint).toBe('AP-01')
    for (let t = 26_000; t <= 30_000; t += 100) station.update(t)
    expect(station.status()).toMatchObject({ state: 'connected', accessPoint: 'AP-02' })
  })

  it('la pérdida de segmentos crece al debilitarse la señal', () => {
    expect(segmentLoss(-65)).toBeLessThan(0.001)
    expect(segmentLoss(-80)).toBeLessThan(0.05)
    expect(segmentLoss(-87)).toBeCloseTo(0.5, 5)
    expect(segmentLoss(-90)).toBeGreaterThan(0.8)
    expect(segmentLoss(null)).toBe(1)
  })
})

describe('manilla con cobertura limitada', () => {
  it('sin señal, la alarma de CO queda en la cola y llega a la central al volver la cobertura', () => {
    const air = radio([{ id: 'AP-06', rssi: -62 }])
    let environment = CLEAN
    const device = bracelet(() => environment, air.scan)
    device.advance(8000)
    expect(device.link().connected).toBe(true)
    expect(device.wifiStatus()).toMatchObject({ state: 'connected', accessPoint: 'AP-06' })

    // Entra a la labor abandonada: sin señal y con CO acumulado.
    air.set([])
    environment = { coPpm: 420, ambientC: 24, objectC: 26 }
    device.advance(30_000)
    expect(device.wifiStatus()?.state).toBe('disconnected')
    expect(device.link().connected).toBe(false)
    // Las alertas locales no dependen del enlace.
    expect(device.assessment().level).toBe('danger')
    expect(device.outputs().buzzer || device.outputs().motor || device.ledColor() === 'red').toBe(true)
    expect(device.pending().messages).toBeGreaterThanOrEqual(1)
    expect(device.centralView().messages).toHaveLength(0)
    const alarmAt = device.centralView().serverTime

    // Sale de la labor y recupera la señal: se asocia, reconecta y vacía la cola.
    environment = CLEAN
    air.set([{ id: 'AP-06', rssi: -64 }])
    device.advance(40_000)
    expect(device.link().connected).toBe(true)
    expect(device.pending().messages).toBe(0)
    const alarm = device.centralView().messages.find(message => message.code === 'CO_ALARM')
    expect(alarm).toBeDefined()
    // Conserva la hora en que se generó (sin señal), no la de entrega.
    const sentAt = parseIso(alarm!.sentAt)!
    expect(sentAt).toBeLessThanOrEqual(alarmAt)
    expect(alarm!.receivedAt - sentAt).toBeGreaterThan(10_000)
    // El registro muestra la caída y la reconexión.
    const events = device.frames().filter(entry => entry.direction === 'event').map(entry => entry.text)
    expect(events.some(text => text.includes('sin balizas'))).toBe(true)
    expect(events.some(text => text.startsWith('Enlace cerrado'))).toBe(true)
    expect(events.filter(text => text.startsWith('WebSocket abierto')).length).toBeGreaterThanOrEqual(2)
  })

  it('sin señal, la central deja de recibir telemetría y marca la manilla fuera de línea a los 90 s', () => {
    const air = radio([{ id: 'AP-01', rssi: -58 }])
    const device = bracelet(() => CLEAN, air.scan)
    device.advance(10_000)
    expect(device.centralView().deviceOnline).toBe(true)
    const telemetry = device.centralView().telemetry
    air.set([])
    device.advance(PRESENCE_WINDOW_MS - 15_000)
    expect(device.centralView().telemetry).toBeLessThanOrEqual(telemetry + 1)
    expect(device.centralView().deviceOnline).toBe(true)
    device.advance(20_000)
    expect(device.centralView().deviceOnline).toBe(false)
    air.set([{ id: 'AP-01', rssi: -58 }])
    device.advance(15_000)
    expect(device.centralView().deviceOnline).toBe(true)
    expect(device.centralView().telemetry).toBeGreaterThan(telemetry + 2)
  })

  it('con señal débil las tramas llegan tarde por las retransmisiones y el enlace se corta y se rehace', () => {
    // Se asocia con señal aceptable y después se aleja hasta el borde de la cobertura.
    const air = radio([{ id: 'AP-05', rssi: -78 }])
    const device = bracelet(() => CLEAN, air.scan, 3)
    device.advance(6000)
    air.set([{ id: 'AP-05', rssi: -86 }])
    device.advance(5 * 60_000)
    const view = device.centralView()
    // Algo llega, pero mucho menos que con buena señal (una lectura cada 2 s = 153).
    expect(view.telemetry).toBeGreaterThan(5)
    expect(view.telemetry).toBeLessThan(140)
    const closes = device.frames().filter(entry => entry.direction === 'event' && entry.text.startsWith('Enlace cerrado'))
    expect(closes.length).toBeGreaterThan(0)
  })

  it('con buena señal se comporta igual que con cobertura total', () => {
    const device = bracelet(() => CLEAN, () => [{ id: 'AP-02', rssi: -55 }])
    device.advance(30_000)
    expect(device.link().connected).toBe(true)
    // Asociación (2,2 s) y luego una lectura cada 2 s sin pérdidas.
    expect(device.centralView().telemetry).toBeGreaterThanOrEqual(11)
    expect(device.centralView().rejected).toBe(0)
  })

  it('la subida de voz espera la cobertura y no se pierde', () => {
    const air = radio([{ id: 'AP-03', rssi: -60 }])
    const device = bracelet(() => CLEAN, air.scan)
    device.advance(6000)
    air.set([])
    device.advance(12_000)
    // Graba un mensaje de voz sin señal.
    for (let i = 0; i < 4; i++) device.press('down')
    device.press('enter')
    device.press('enter')
    device.advance(4200)
    device.press('enter')
    device.press('enter')
    expect(device.menuState().voiceStatus).toBe('Guardado en cola')
    device.advance(20_000)
    expect(device.pending().voices).toBe(1)
    expect(device.centralView().voices).toHaveLength(0)
    air.set([{ id: 'AP-03', rssi: -60 }])
    device.advance(40_000)
    expect(device.pending().voices).toBe(0)
    expect(device.centralView().voices).toHaveLength(1)
  })
})
