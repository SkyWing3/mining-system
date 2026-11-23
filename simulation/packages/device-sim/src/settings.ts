// Configuración de la manilla virtual: subconjunto de settings.h que afecta al
// comportamiento (los pines, el Wi-Fi y la credencial no aplican al gemelo).

export interface Threshold {
  readonly caution: number
  readonly danger: number
}

export interface CoCalibration {
  readonly baselineVolts: number
  readonly ppmPerVolt: number
}

/** ppm a partir de la tensión con una calibración de dos puntos; nunca negativo. */
export function calibrationPpm(calibration: CoCalibration, volts: number): number {
  const value = (volts - calibration.baselineVolts) * calibration.ppmPerVolt
  return value > 0 ? value : 0
}

export interface AlertsSettings {
  readonly silenceSeconds: number
  readonly buttonFeedback: boolean
  readonly confirmSamples: number
  readonly coPpm: Threshold
  readonly ambientC: Threshold
  readonly objectC: Threshold
}

export interface DeviceSettings {
  readonly alerts: AlertsSettings
  readonly sensors: {
    readonly sampleSeconds: number
    readonly co: { readonly warmupSeconds: number; readonly calibration: CoCalibration | null }
  }
  /** null equivale a una manilla sin credencial: «Central: sin configurar». */
  readonly connection: { readonly telemetrySeconds: number; readonly heartbeatSeconds: number } | null
  readonly voice: { readonly enabled: boolean; readonly maxSeconds: number; readonly maxPending: number }
}

/**
 * Respuesta del SEN0564 que usa el modo simulado del firmware (SimulatedSensors):
 * 0,12 V en aire limpio y 0,0015 V por ppm. La calibración por defecto del gemelo
 * es la inversa exacta, así la manilla informa ppm como con `sensors.simulated`.
 */
export const SENSOR_RESPONSE = { baselineVolts: 0.12, voltsPerPpm: 0.0015 } as const

/**
 * Valores por defecto de config/settings.example.json del firmware, salvo el
 * precalentamiento del CO (180 s en la placa, 0 en el gemelo) y la calibración,
 * que en la placa se mide y aquí corresponde a SENSOR_RESPONSE.
 */
export const DEFAULT_SETTINGS: DeviceSettings = {
  alerts: {
    silenceSeconds: 60,
    buttonFeedback: true,
    confirmSamples: 3,
    coPpm: { caution: 35, danger: 200 },
    ambientC: { caution: 32, danger: 38 },
    objectC: { caution: 60, danger: 90 },
  },
  sensors: {
    sampleSeconds: 1,
    co: { warmupSeconds: 0, calibration: { baselineVolts: 0.12, ppmPerVolt: 666.67 } },
  },
  connection: { telemetrySeconds: 2, heartbeatSeconds: 20 },
  voice: { enabled: true, maxSeconds: 30, maxPending: 20 },
}

/** Tamaño máximo del detalle de una alarma automática (kMaxDetail). */
export const MAX_DETAIL = 120
