// Sensores, telemetría y reloj (port de esp32-device/test/test_sensors) y sensores ambientales del gemelo.
import { describe, expect, it } from 'vitest'
import {
  Assessment, computeCalibration, DEFAULT_SETTINGS, emptySnapshot, EnvironmentSensors, formatIso, parseIso, SensorHub, SimulatedSensors,
  telemetryFields, telemetryFrame, WallClock, type EnvironmentSample,
} from '../src/index.ts'
import { FakeClock } from './fakes.ts'

describe('telemetría', () => {
  it('descarta valores fuera de rango y conserva el nivel', () => {
    const assessment = new Assessment('danger')
    const reading = telemetryFields({ snapshot: emptySnapshot({ ambientC: 200, objectC: 25.123456, coVolts: 0.41 }), assessment, sampledAt: 0 })
    expect(reading).not.toBeNull()
    expect(reading?.temperatureC).toBeNull()
    expect(reading?.objectTemperatureC).toBeCloseTo(25.1235, 9)
    expect(reading?.level).toBe('danger')
    const frame = JSON.parse(telemetryFrame(reading as NonNullable<typeof reading>)) as Record<string, unknown>
    expect(frame.type).toBe('telemetry')
    expect(frame.level).toBe('danger')
    expect(frame.temperatureC).toBeUndefined()
    expect(frame.gasPpm).toBeUndefined()
    expect(telemetryFields({ snapshot: emptySnapshot(), assessment: new Assessment(), sampledAt: 0 })).toBeNull()
  })

  it('la trama conserva el orden de campos del firmware', () => {
    const frame = telemetryFrame({ temperatureC: 24.5, objectTemperatureC: 26.1235, gasPpm: 12, gasVoltage: 0.138, level: 'caution', simulated: true })
    expect(frame).toBe('{"type":"telemetry","temperatureC":24.5,"objectTemperatureC":26.1235,"gasPpm":12,"gasVoltage":0.138,"level":"caution","simulated":true}')
    const voltsOnly = telemetryFrame({ temperatureC: null, objectTemperatureC: null, gasPpm: null, gasVoltage: 0.412, level: 'normal', simulated: false })
    expect(voltsOnly).toBe('{"type":"telemetry","gasVoltage":0.412,"level":"normal","simulated":false}')
  })

  it('el concentrador publica y vence las muestras viejas', () => {
    const clock = new FakeClock()
    const sensors = new SimulatedSensors(clock.fn)
    let published = 0
    const hub = new SensorHub(sensors, DEFAULT_SETTINGS.alerts, 1000, () => { published += 1 }, clock.fn)
    expect(hub.telemetry()).toBeNull()
    hub.sampleOnce()
    expect(published).toBe(1)
    expect(hub.telemetry()?.simulated).toBe(true)
    clock.now = 5000
    expect(hub.telemetry()).not.toBeNull()
    clock.now = 5001
    expect(hub.telemetry()).toBeNull()
  })

  it('calibración por dos puntos', () => {
    const result = computeCalibration(0.41234, 0.81234, 100)
    expect('calibration' in result && result.calibration.baselineVolts).toBeCloseTo(0.4123, 9)
    expect('calibration' in result && result.calibration.ppmPerVolt).toBeCloseTo(250, 9)
    expect('error' in computeCalibration(0.5, 0.4, 100)).toBe(true)
    expect('error' in computeCalibration(0.4, 0.5, 0)).toBe(true)
  })

  it('picos de prueba de los sensores simulados del firmware', () => {
    const clock = new FakeClock()
    const sensors = new SimulatedSensors(clock.fn)
    sensors.spikeGas()
    let snapshot = sensors.sample()
    for (let i = 0; i < 12; i++) snapshot = sensors.sample()
    expect(snapshot.coPpm ?? 0).toBeGreaterThan(200)
    clock.now = 30000
    for (let i = 0; i < 20; i++) snapshot = sensors.sample()
    expect(snapshot.coPpm ?? 999).toBeLessThan(35)
    sensors.spikeHeat()
    for (let i = 0; i < 20; i++) snapshot = sensors.sample()
    expect(snapshot.ambientC ?? 0).toBeGreaterThan(38)
  })
})

describe('reloj', () => {
  it('ISO 8601 de ida y vuelta', () => {
    expect(formatIso(0)).toBe('1970-01-01T00:00:00.000Z')
    expect(formatIso(1709251199999)).toBe('2024-02-29T23:59:59.999Z')
    expect(formatIso(parseIso('2026-11-16T19:04:05.1234567Z') ?? 0)).toBe('2026-11-16T19:04:05.123Z')
    expect(formatIso(parseIso('2026-11-16T15:04:05-04:00') ?? 0)).toBe('2026-11-16T19:04:05.000Z')
    expect(parseIso('2026-11-16T19:04:05')).not.toBeNull()
    expect(parseIso('2026-11-16')).toBeNull()
    expect(parseIso('2026-13-16T19:04:05Z')).toBeNull()
    expect(parseIso('2026-11-16T19:04:05Zx')).toBeNull()
  })

  it('resuelve sellos del mismo arranque', () => {
    const uptime = new FakeClock()
    const wall = new WallClock(7, uptime.fn)
    uptime.now = 1000
    const early = wall.stamp()
    expect(early.epochMs).toBe(-1)
    expect(wall.resolve(early)).toBeNull()
    uptime.now = 5000
    wall.sync(Date.UTC(2026, 10, 16, 19, 4, 5))
    expect(formatIso(wall.resolve(early) ?? 0)).toBe('2026-11-16T19:04:01.000Z')
    expect(wall.resolve({ epochMs: -1, boot: 6, uptimeMs: 1000 })).toBeNull()
    // Diferencias menores a 1 s (latencia) no mueven el reloj.
    wall.sync(Date.UTC(2026, 10, 16, 19, 4, 5, 500))
    expect(formatIso(wall.now() ?? 0)).toBe('2026-11-16T19:04:05.000Z')
  })
})

describe('sensores ambientales del gemelo', () => {
  const clean: EnvironmentSample = { coPpm: 1, ambientC: 18, objectC: 19 }

  it('parten del valor real, siguen el ambiente con retardo y marcan las lecturas como simuladas', () => {
    const clock = new FakeClock()
    let truth = clean
    const sensors = new EnvironmentSensors({ clock: clock.fn, environment: () => truth, warmupSeconds: 0, calibration: DEFAULT_SETTINGS.sensors.co.calibration, seed: 3 })
    const first = sensors.sample()
    expect(first.simulated).toBe(true)
    expect(first.coState).toBe('ok')
    expect(first.ambientC ?? 0).toBeCloseTo(18, 0)
    truth = { coPpm: 300, ambientC: 30, objectC: 45 }
    const ppm: number[] = []
    let last = first
    for (let second = 1; second <= 40; second++) {
      clock.now = second * 1000
      last = sensors.sample()
      ppm.push(last.coPpm ?? 0)
    }
    // CO con τ ≈ 8 s: a los 8 s ronda el 63 % y a los 40 s está cerca del valor real.
    expect(ppm[7]).toBeGreaterThan(150)
    expect(ppm[7]).toBeLessThan(230)
    expect(last.coPpm ?? 0).toBeGreaterThan(290)
    // El objeto (infrarrojo) responde casi de inmediato; el ambiente, lento.
    expect(last.objectC ?? 0).toBeCloseTo(45, 0)
    expect(last.ambientC ?? 0).toBeGreaterThan(27)
    expect(last.ambientC ?? 0).toBeLessThan(30)
    // La tensión corresponde a la respuesta del SEN0564 del modo simulado del firmware.
    expect(last.coVolts ?? 0).toBeCloseTo(0.12 + (last.coPpm ?? 0) * 0.0015, 3)
  })

  it('sin calibración solo informa la tensión, y durante el precalentamiento tampoco hay ppm', () => {
    const clock = new FakeClock()
    const sensors = new EnvironmentSensors({ clock: clock.fn, environment: () => clean, warmupSeconds: 180, calibration: null })
    let snapshot = sensors.sample()
    expect(snapshot.coState).toBe('warming')
    expect(snapshot.warmupRemaining).toBe(180)
    expect(snapshot.coPpm).toBeNull()
    expect(snapshot.coVolts).not.toBeNull()
    clock.now = 180_000
    snapshot = sensors.sample()
    expect(snapshot.coState).toBe('uncalibrated')
    expect(snapshot.coPpm).toBeNull()
  })

  it('el pico de calor alcanza el umbral de peligro como en el firmware', () => {
    const clock = new FakeClock()
    const sensors = new EnvironmentSensors({ clock: clock.fn, environment: () => clean, warmupSeconds: 0, calibration: DEFAULT_SETTINGS.sensors.co.calibration })
    sensors.sample()
    sensors.spikeHeat()
    let snapshot = sensors.sample()
    for (let second = 1; second <= 20; second++) {
      clock.now = second * 1000
      snapshot = sensors.sample()
    }
    expect(snapshot.ambientC ?? 0).toBeGreaterThan(38)
    expect(snapshot.objectC ?? 0).toBeGreaterThan(snapshot.ambientC ?? 0)
  })
})
