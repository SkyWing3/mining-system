// Sensores y telemetría (sensors.cpp).
//
// En la placa, el SEN0564 (CO) se lee con el ADC y el MLX90614 por SMBus. En el
// gemelo, `EnvironmentSensors` lee el modelo ambiental en la posición del minero y
// aplica la dinámica de cada sensor (retardo y ruido). Las lecturas siempre se
// marcan como simuladas, igual que con `sensors.simulated` en el firmware.
import { ThresholdEvaluator } from './levels.ts'
import type { MonitorUpdate } from './events.ts'
import { createRandom, rounded, type Random } from './rng.ts'
import type { SensorSnapshot } from './readings.ts'
import { calibrationPpm, SENSOR_RESPONSE, type AlertsSettings, type CoCalibration } from './settings.ts'
import type { Level, MonotonicClock } from './types.ts'

/** Valores físicos verdaderos en la posición de la manilla (modelo ambiental del gemelo). */
export interface EnvironmentSample {
  readonly coPpm: number
  readonly ambientC: number
  readonly objectC: number
}

export interface SensorSource {
  sample(): SensorSnapshot
}

/** Constantes de tiempo de la respuesta de cada sensor, en segundos. */
export const SENSOR_DYNAMICS = {
  /** SEN0564: respuesta del elemento sensor al cambio de concentración. */
  coTau: 8,
  /** MLX90614 ambiente: masa térmica de la caja de la manilla. */
  ambientTau: 25,
  /** MLX90614 objeto: medición infrarroja, casi inmediata. */
  objectTau: 0.6,
  coNoisePpm: 1.2,
  ambientNoise: 0.08,
  objectNoise: 0.15,
} as const

/** Picos de prueba de la consola del firmware (`simulate gas` / `simulate heat`). */
const SPIKE_PPM = 260
const SPIKE_AMBIENT = 41

export interface EnvironmentSensorsOptions {
  readonly clock: MonotonicClock
  readonly environment: () => EnvironmentSample
  readonly warmupSeconds: number
  readonly calibration: CoCalibration | null
  readonly seed?: number
}

export class EnvironmentSensors implements SensorSource {
  private readonly clock: MonotonicClock
  private readonly environment: () => EnvironmentSample
  private readonly warmupMs: number
  private readonly started: number
  private readonly random: Random
  private calibration: CoCalibration | null
  private lastSample: number | null = null
  private co = 0
  private ambient = 0
  private object = 0
  // Desplazamiento de los picos de prueba; se acerca al objetivo como SimulatedSensors.
  private gasOffset = 0
  private heatOffset = 0
  private gasUntil = 0
  private heatUntil = 0

  constructor(options: EnvironmentSensorsOptions) {
    this.clock = options.clock
    this.environment = options.environment
    this.warmupMs = options.warmupSeconds * 1000
    this.calibration = options.calibration
    this.started = this.clock()
    this.random = createRandom(options.seed ?? 1)
  }

  setCalibration(calibration: CoCalibration | null): void {
    this.calibration = calibration
  }

  hasCalibration(): boolean {
    return this.calibration !== null
  }

  spikeGas(durationMs = 25000): void {
    this.gasUntil = this.clock() + durationMs
  }

  spikeHeat(durationMs = 25000): void {
    this.heatUntil = this.clock() + durationMs
  }

  /** Segundos de precalentamiento restantes, redondeados como CoSensor. */
  warmupRemaining(): number {
    const remaining = this.warmupMs - (this.clock() - this.started)
    return remaining > 0 ? Math.floor((remaining + 500) / 1000) : 0
  }

  sample(): SensorSnapshot {
    const now = this.clock()
    const truth = this.environment()
    if (this.lastSample === null) {
      // Sin rampa artificial al arrancar: el filtro parte del valor real.
      this.co = truth.coPpm
      this.ambient = truth.ambientC
      this.object = truth.objectC
    } else {
      const dt = Math.max(0, now - this.lastSample) / 1000
      this.co += (truth.coPpm - this.co) * (1 - Math.exp(-dt / SENSOR_DYNAMICS.coTau))
      this.ambient += (truth.ambientC - this.ambient) * (1 - Math.exp(-dt / SENSOR_DYNAMICS.ambientTau))
      this.object += (truth.objectC - this.object) * (1 - Math.exp(-dt / SENSOR_DYNAMICS.objectTau))
    }
    this.lastSample = now

    const gasTarget = now < this.gasUntil ? Math.max(0, SPIKE_PPM - this.co) : 0
    const heatTarget = now < this.heatUntil ? Math.max(0, SPIKE_AMBIENT - this.ambient) : 0
    this.gasOffset += (gasTarget - this.gasOffset) * 0.35
    this.heatOffset += (heatTarget - this.heatOffset) * 0.3

    const ppm = Math.max(0, this.co + this.gasOffset + this.random.gaussian(SENSOR_DYNAMICS.coNoisePpm))
    const ambient = this.ambient + this.heatOffset + this.random.gaussian(SENSOR_DYNAMICS.ambientNoise)
    // Durante el pico de calor el objeto acompaña al ambiente (+2,5 °C), como en el firmware.
    const objectBase = this.heatOffset > 0.01 ? Math.max(this.object, ambient + 2.5) : this.object
    const object = objectBase + this.random.gaussian(SENSOR_DYNAMICS.objectNoise)

    // Tensión del SEN0564 (respuesta física) y ppm solo con calibración y después del precalentamiento.
    const volts = Math.max(0, rounded(SENSOR_RESPONSE.baselineVolts + ppm * SENSOR_RESPONSE.voltsPerPpm, 4))
    const warmupRemaining = this.warmupRemaining()
    let coPpm: number | null = null
    let coState: SensorSnapshot['coState']
    if (warmupRemaining > 0) coState = 'warming'
    else if (!this.calibration) coState = 'uncalibrated'
    else {
      coPpm = rounded(calibrationPpm(this.calibration, volts), 1)
      coState = 'ok'
    }
    return {
      ambientC: rounded(ambient, 2),
      objectC: rounded(object, 2),
      coVolts: volts,
      coPpm,
      coState,
      thermometerState: 'ok',
      warmupRemaining,
      simulated: true,
    }
  }
}

/** Port de SimulatedSensors: lecturas sintéticas fijas con picos, sin modelo ambiental. */
export class SimulatedSensors implements SensorSource {
  private readonly clock: MonotonicClock
  private readonly random: Random
  private gasUntil = 0
  private heatUntil = 0
  private ambient = 24.0
  private object = 26.5
  private ppm = 6.0

  constructor(clock: MonotonicClock, seed = 1) {
    this.clock = clock
    this.random = createRandom(seed)
  }

  spikeGas(durationMs = 25000): void { this.gasUntil = this.clock() + durationMs }
  spikeHeat(durationMs = 25000): void { this.heatUntil = this.clock() + durationMs }

  sample(): SensorSnapshot {
    const now = this.clock()
    const ppmTarget = now < this.gasUntil ? SPIKE_PPM : 6.0
    const ambientTarget = now < this.heatUntil ? SPIKE_AMBIENT : 24.0
    this.ppm = Math.max(0, this.ppm + (ppmTarget - this.ppm) * 0.35 + this.random.gaussian(1.2))
    this.ambient += (ambientTarget - this.ambient) * 0.3 + this.random.gaussian(0.08)
    this.object += (ambientTarget + 2.5 - this.object) * 0.3 + this.random.gaussian(0.15)
    return {
      ambientC: rounded(this.ambient, 2),
      objectC: rounded(this.object, 2),
      coVolts: rounded(SENSOR_RESPONSE.baselineVolts + this.ppm * SENSOR_RESPONSE.voltsPerPpm, 4),
      coPpm: rounded(this.ppm, 1),
      coState: 'ok',
      thermometerState: 'ok',
      warmupRemaining: 0,
      simulated: true,
    }
  }
}

// --- Telemetría ------------------------------------------------------------

export interface TelemetryReading {
  readonly temperatureC: number | null
  readonly objectTemperatureC: number | null
  readonly gasPpm: number | null
  readonly gasVoltage: number | null
  readonly level: Level
  readonly simulated: boolean
}

/** Valores fuera de los límites de transporte de la central (docs/api.md) se descartan. */
function limited(value: number | null, low: number, high: number): number | null {
  if (value === null || !Number.isFinite(value) || value < low || value > high) return null
  return rounded(value, 4)
}

export function telemetryFields(update: MonitorUpdate): TelemetryReading | null {
  const snapshot = update.snapshot
  const reading: TelemetryReading = {
    temperatureC: limited(snapshot.ambientC, -50, 150),
    objectTemperatureC: limited(snapshot.objectC, -70, 380),
    gasPpm: limited(snapshot.coPpm, 0, 1_000_000),
    gasVoltage: limited(snapshot.coVolts, 0, 5.5),
    level: update.assessment.level,
    simulated: snapshot.simulated,
  }
  if (reading.temperatureC === null && reading.objectTemperatureC === null && reading.gasPpm === null && reading.gasVoltage === null) return null
  return reading
}

/** Trama JSON de telemetría con el mismo orden de campos que el firmware. */
export function telemetryFrame(reading: TelemetryReading): string {
  const frame: Record<string, unknown> = { type: 'telemetry' }
  if (reading.temperatureC !== null) frame.temperatureC = reading.temperatureC
  if (reading.objectTemperatureC !== null) frame.objectTemperatureC = reading.objectTemperatureC
  if (reading.gasPpm !== null) frame.gasPpm = reading.gasPpm
  if (reading.gasVoltage !== null) frame.gasVoltage = reading.gasVoltage
  frame.level = reading.level
  frame.simulated = reading.simulated
  return JSON.stringify(frame)
}

// --- Concentrador ------------------------------------------------------------

/**
 * Cada muestra se clasifica y se publica a la aplicación; el enlace lee la última
 * muestra para transmitirla como telemetría en vivo.
 */
export class SensorHub {
  readonly intervalMs: number
  private readonly source: SensorSource
  private readonly evaluator: ThresholdEvaluator
  private readonly publish: (update: MonitorUpdate) => void
  private readonly clock: MonotonicClock
  private last: MonitorUpdate | null = null

  constructor(source: SensorSource, alerts: AlertsSettings, intervalMs: number, publish: (update: MonitorUpdate) => void, clock: MonotonicClock) {
    this.source = source
    this.evaluator = new ThresholdEvaluator(alerts)
    this.intervalMs = intervalMs
    this.publish = publish
    this.clock = clock
  }

  sampleOnce(): MonitorUpdate {
    const snapshot = this.source.sample()
    const update: MonitorUpdate = { snapshot, assessment: this.evaluator.update(snapshot), sampledAt: this.clock() }
    this.last = update
    this.publish(update)
    return update
  }

  latest(): MonitorUpdate | null {
    return this.last
  }

  /** Última muestra como telemetría, o nada si no hay una muestra reciente. */
  telemetry(): TelemetryReading | null {
    const update = this.last
    if (!update || this.clock() - update.sampledAt > Math.max(3 * this.intervalMs, 5000)) return null
    return telemetryFields(update)
  }
}

/**
 * Calibración por dos puntos (tools/calibrate_co.py): línea base en aire limpio y
 * tensión con un gas de referencia de concentración conocida.
 */
export function computeCalibration(baselineVolts: number, referenceVolts: number, referencePpm: number): { calibration: CoCalibration } | { error: string } {
  if (!(referencePpm > 0)) return { error: 'La concentración de referencia debe ser positiva.' }
  if (referenceVolts <= baselineVolts) return { error: 'La tensión con gas no supera la línea base; repite la medición.' }
  return { calibration: { baselineVolts: rounded(baselineVolts, 4), ppmPerVolt: rounded(referencePpm / (referenceVolts - baselineVolts), 2) } }
}
