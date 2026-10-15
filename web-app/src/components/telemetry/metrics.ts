import type { Reading } from '../../types/domain'
import { parseDate } from '../../utils/format'
import type { ChartPoint } from './LineChart'

export type MetricKey = 'temperatureC' | 'objectTemperatureC' | 'gas' | 'batteryPercent'

export interface Metric {
  key: MetricKey
  label: string
  unit: string
  decimals: number
  value: (reading: Reading) => number | null
}

// Gas is charted in ppm once calibrated readings exist; otherwise as the raw SEN0564 voltage.
export function metricsFor(readings: Reading[]): Metric[] {
  const calibrated = readings.some(reading => reading.gasPpm !== null)
  return [
    { key: 'temperatureC', label: 'Temperatura', unit: '°C', decimals: 1, value: reading => reading.temperatureC },
    { key: 'objectTemperatureC', label: 'Objeto', unit: '°C', decimals: 1, value: reading => reading.objectTemperatureC },
    calibrated
      ? { key: 'gas', label: 'Gas', unit: 'ppm', decimals: 0, value: reading => reading.gasPpm }
      : { key: 'gas', label: 'Gas', unit: 'V', decimals: 3, value: reading => reading.gasVoltage },
    { key: 'batteryPercent', label: 'Batería', unit: '%', decimals: 0, value: reading => reading.batteryPercent },
  ]
}

export function chartPoints(readings: Reading[], metric: Metric): ChartPoint[] {
  return readings.map(reading => ({ time: parseDate(reading.receivedAt).getTime(), value: metric.value(reading) }))
}
