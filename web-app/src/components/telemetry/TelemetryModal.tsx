import { useEffect, useMemo, useState } from 'react'
import { devicesApi } from '../../api/endpoints'
import { loadWithRecovery } from '../../api/client'
import type { Device, Reading } from '../../types/domain'
import { date, levelName } from '../../utils/format'
import { mergeReadings } from '../../realtime/liveTelemetry'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Feedback'
import { LevelBadge, SimulatedTag } from '../devices/DeviceIndicators'
import { LineChart } from './LineChart'
import { chartPoints, metricsFor } from './metrics'
import type { MetricKey } from './metrics'

const HISTORY = 100
const TABLE_ROWS = 15

// Stored history plus every live reading received while the dialog is open.
export function TelemetryModal({ device, live, close, onError }: {
  device: Device
  live: Reading[]
  close: () => void
  onError: (error: unknown) => void
}) {
  const [history, setHistory] = useState<Reading[] | null>(null)
  const [metricKey, setMetricKey] = useState<MetricKey>('temperatureC')
  const [view, setView] = useState<'chart' | 'table'>('chart')

  useEffect(() => loadWithRecovery(
    signal => devicesApi.telemetry(device.id, { limit: HISTORY }, signal),
    readings => setHistory(readings.toReversed()),
    onError,
  ), [device.id, onError])

  const readings = useMemo(() => (history ? mergeReadings(history, live, Infinity, HISTORY + live.length) : []), [history, live])
  const metrics = metricsFor(readings)
  const metric = metrics.find(item => item.key === metricKey) ?? metrics[0]
  const points = chartPoints(readings, metric)
  const values = points.filter(point => point.value !== null)
  const latest = values.at(-1)?.value ?? null
  const simulated = readings.at(-1)?.simulated ?? false

  return (
    <Modal title={`Lecturas · ${device.name}`} subtitle={`${device.minerName ?? 'Sin asignar'} · ${device.zone}`} close={close} wide>
      <div className="telemetry-content">
        <div className="telemetry-toolbar">
          <div className="tabs" role="group" aria-label="Medición">
            {metrics.map(item => (
              <button key={item.key} className={item.key === metric.key ? 'selected' : ''} aria-pressed={item.key === metric.key} onClick={() => setMetricKey(item.key)}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="tabs" role="group" aria-label="Vista">
            <button className={view === 'chart' ? 'selected' : ''} aria-pressed={view === 'chart'} onClick={() => setView('chart')}>Gráfico</button>
            <button className={view === 'table' ? 'selected' : ''} aria-pressed={view === 'table'} onClick={() => setView('table')}>Tabla</button>
          </div>
        </div>
        {history === null ? <Spinner label="Cargando lecturas…" /> : values.length ? (
          <>
            <div className="chart-label">
              <strong>{latest!.toFixed(metric.decimals)} <small>{metric.unit}</small></strong>
              <span className="chart-meta">
                {readings.at(-1) && <LevelBadge level={readings.at(-1)!.level} />}
                {simulated && <SimulatedTag />}
                <span>Últimas {values.length} lecturas · se actualiza en vivo</span>
              </span>
            </div>
            {view === 'chart'
              ? <LineChart points={points} unit={metric.unit} decimals={metric.decimals} label={`Historial de ${metric.label.toLowerCase()}`} />
              : <ReadingTable readings={readings} metric={metric} />}
          </>
        ) : (
          <div className="empty">
            <h3>Sin lecturas de este sensor</h3>
            <p>Las mediciones aparecerán cuando la manilla las envíe.</p>
          </div>
        )}
        <p className="form-hint">
          {metric.key === 'gas' && metric.unit === 'V'
            ? 'El sensor de CO aún no está calibrado: se muestra su tensión, no una concentración.'
            : 'Los niveles provienen de los umbrales configurados en la manilla. Una lectura no reemplaza la evaluación en terreno.'}
        </p>
      </div>
    </Modal>
  )
}

function ReadingTable({ readings, metric }: { readings: Reading[]; metric: ReturnType<typeof metricsFor>[number] }) {
  const rows = readings.filter(reading => metric.value(reading) !== null).slice(-TABLE_ROWS).reverse()
  return (
    <div className="table-scroll reading-table">
      <table>
        <thead><tr><th>HORA</th><th>{metric.label.toUpperCase()}</th><th>NIVEL</th><th>PORTADOR · ZONA</th></tr></thead>
        <tbody>
          {rows.map(reading => (
            <tr key={reading.receivedAt}>
              <td>{date(reading.receivedAt)}</td>
              <td>{metric.value(reading)!.toFixed(metric.decimals)} {metric.unit}</td>
              <td>{levelName[reading.level]}</td>
              <td className="muted">{reading.minerName || 'Sin asignar'} · {reading.zone}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
