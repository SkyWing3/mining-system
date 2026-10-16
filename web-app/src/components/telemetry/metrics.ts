import type { Reading } from '../../types/domain'
import { parseDate } from '../../utils/format'
import type { ChartPoint } from './LineChart'

export type MetricKey = 'temperatureC' | 'objectTemperatureC' | 'gas' | 'batteryPercent'

export interface Metric {
  key: MetricKey
  // Short name shared with the live cards; the description names the series for charts and screen readers.
  label: string
  description: string
  unit: string
  decimals: number
  value: (reading: Reading) => number | null
}

// Gas is charted in ppm once calibrated readings exist; otherwise as the raw SEN0564 voltage.
export function metricsFor(readings: Reading[]): Metric[] {
  const calibrated = readings.some(reading => reading.gasPpm !== null)
  return [
    { key: 'temperatureC', label: 'Ambiente', description: 'temperatura ambiente', unit: '°C', decimals: 1, value: reading => reading.temperatureC },
    { key: 'objectTemperatureC', label: 'Objeto', description: 'temperatura de objeto', unit: '°C', decimals: 1, value: reading => reading.objectTemperatureC },
    calibrated
      ? { key: 'gas', label: 'CO', description: 'CO', unit: 'ppm', decimals: 0, value: reading => reading.gasPpm }
      : { key: 'gas', label: 'CO (sin calibrar)', description: 'tensión del sensor de CO', unit: 'V', decimals: 3, value: reading => reading.gasVoltage },
    { key: 'batteryPercent', label: 'Batería', description: 'batería', unit: '%', decimals: 0, value: reading => reading.batteryPercent },
  ]
}

export function chartPoints(readings: Reading[], metric: Metric): ChartPoint[] {
  return readings.map(reading => ({ time: parseDate(reading.receivedAt).getTime(), value: metric.value(reading) }))
}
