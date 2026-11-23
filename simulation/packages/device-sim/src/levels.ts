// Clasificación de lecturas en normal, precaución y peligro (levels.cpp).
//
// Cada métrica cambia de nivel solo después de `confirmSamples` muestras
// consecutivas, y para bajar necesita alejarse del umbral (histéresis). Así una
// lectura aislada no dispara ni apaga una alarma.
import type { SensorSnapshot } from './readings.ts'
import type { AlertsSettings, Threshold } from './settings.ts'
import { levelRank, type Level } from './types.ts'

export type AlarmGroup = 'co' | 'heat'

export interface Metric {
  readonly key: 'co' | 'ambient' | 'object'
  readonly label: string
  readonly unit: string
  readonly hysteresis: number
  /** Grupo de la alarma enviada a la central: «co» o «heat». */
  readonly group: AlarmGroup
}

export const METRICS: readonly Metric[] = [
  { key: 'co', label: 'CO', unit: 'ppm', hysteresis: 5.0, group: 'co' },
  { key: 'ambient', label: 'Ambiente', unit: '°C', hysteresis: 1.0, group: 'heat' },
  { key: 'object', label: 'Objeto', unit: '°C', hysteresis: 2.0, group: 'heat' },
]

export class Condition {
  readonly metric: Metric
  readonly level: Level
  readonly value: number

  constructor(metric: Metric, level: Level, value: number) {
    this.metric = metric
    this.level = level
    this.value = value
  }

  /** Por ejemplo «CO 245 ppm» o «Ambiente 41.0 °C». */
  text(): string {
    const ppm = this.metric.unit === 'ppm'
    return `${this.metric.label} ${this.value.toFixed(ppm ? 0 : 1)} ${this.metric.unit}`
  }
}

export class Assessment {
  level: Level
  readonly conditions: Condition[]

  constructor(level: Level = 'normal', conditions: Condition[] = []) {
    this.level = level
    this.conditions = conditions
  }

  groupLevel(group: AlarmGroup): Level {
    let result: Level = 'normal'
    for (const condition of this.conditions) {
      if (condition.metric.group === group && levelRank(condition.level) > levelRank(result)) result = condition.level
    }
    return result
  }

  /** Texto corto de la alarma automática con las condiciones en peligro del grupo. */
  detail(group: AlarmGroup): string {
    return this.conditions
      .filter(condition => condition.metric.group === group && condition.level === 'danger')
      .map(condition => condition.text())
      .join(', ')
  }
}

export function classify(value: number, threshold: Threshold, current: Level, hysteresis: number): Level {
  if (value >= threshold.danger || (current === 'danger' && value > threshold.danger - hysteresis)) return 'danger'
  if (value >= threshold.caution || (levelRank(current) >= 1 && value > threshold.caution - hysteresis)) return 'caution'
  return 'normal'
}

interface MetricState {
  level: Level
  pending: Level | null
  count: number
  value: number | null
}

export class ThresholdEvaluator {
  private readonly config: AlertsSettings
  private readonly states: MetricState[] = METRICS.map(() => ({ level: 'normal', pending: null, count: 0, value: null }))

  constructor(config: AlertsSettings) {
    this.config = config
  }

  update(snapshot: SensorSnapshot): Assessment {
    const values = [snapshot.coPpm, snapshot.ambientC, snapshot.objectC]
    const assessment = new Assessment()
    METRICS.forEach((metric, index) => {
      const value = values[index]
      // Sin valor no hay evidencia para cambiar el nivel.
      if (value !== null) this.step(index, value)
      const state = this.states[index]
      if (state.level !== 'normal' && state.value !== null) {
        assessment.conditions.push(new Condition(metric, state.level, state.value))
        if (levelRank(state.level) > levelRank(assessment.level)) assessment.level = state.level
      }
    })
    return assessment
  }

  private threshold(index: number): Threshold {
    return index === 0 ? this.config.coPpm : index === 1 ? this.config.ambientC : this.config.objectC
  }

  private step(index: number, value: number): void {
    const state = this.states[index]
    state.value = value
    const target = classify(value, this.threshold(index), state.level, METRICS[index].hysteresis)
    if (target === state.level) {
      state.pending = null
      state.count = 0
      return
    }
    if (state.pending === target) {
      state.count += 1
    } else {
      state.pending = target
      state.count = 1
    }
    if (state.count >= this.config.confirmSamples) {
      state.level = target
      state.pending = null
      state.count = 0
    }
  }
}
