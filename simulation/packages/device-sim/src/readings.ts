// Instantánea de los sensores, independiente del hardware que la produjo (readings.h).

/** Estado del SEN0564 que se muestra en la OLED y decide qué se transmite. */
export type CoState = 'disabled' | 'error' | 'warming' | 'uncalibrated' | 'ok'
export type ThermometerState = 'disabled' | 'error' | 'ok'

export interface SensorSnapshot {
  readonly ambientC: number | null
  readonly objectC: number | null
  readonly coVolts: number | null
  readonly coPpm: number | null
  readonly coState: CoState
  readonly thermometerState: ThermometerState
  readonly warmupRemaining: number
  readonly simulated: boolean
}

export function emptySnapshot(overrides: Partial<SensorSnapshot> = {}): SensorSnapshot {
  return {
    ambientC: null,
    objectC: null,
    coVolts: null,
    coPpm: null,
    coState: 'disabled',
    thermometerState: 'disabled',
    warmupRemaining: 0,
    simulated: false,
    ...overrides,
  }
}

export function hasMeasurements(snapshot: SensorSnapshot): boolean {
  return snapshot.ambientC !== null || snapshot.objectC !== null || snapshot.coVolts !== null || snapshot.coPpm !== null
}
