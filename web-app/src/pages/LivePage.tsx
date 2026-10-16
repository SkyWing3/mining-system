import { memo, useEffect, useMemo, useRef } from 'react'
import { Battery, ChevronRight, CircleHelp, Radio, Thermometer, Wind } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { devicesApi } from '../api/endpoints'
import { isTransient } from '../api/client'
import { DeviceStatus, LevelBadge, ReadingOrigin } from '../components/devices/DeviceIndicators'
import { Sparkline } from '../components/telemetry/LineChart'
import type { ChartPoint } from '../components/telemetry/LineChart'
import { Empty } from '../components/ui/Feedback'
import { useNow, useNowCheck } from '../realtime/clock'
import { LIVE_WINDOW_MS } from '../realtime/liveTelemetry'
import type { LiveSeries } from '../realtime/liveTelemetry'
import type { Device, Page, Reading } from '../types/domain'
import { elapsed, gas, isUncalibrated, parseDate, percent, temperature } from '../utils/format'
import { levelRank } from '../utils/levels'

// A device sends a reading every ~2 s; after 10 s without one the card is marked as stale.
const STALE_MS = 10_000

export function LivePage({ devices, series, seed, resync, inspect, navigate, onError }: {
  devices: Device[]
  series: LiveSeries
  seed: (deviceId: string, readings: Reading[]) => void
  resync: number
  inspect: (device: Device) => void
  navigate: (page: Page) => void
  onError: (error: unknown) => void
}) {
  const active = devices.filter(device => device.active)
  useSeedLiveSeries(active, seed, resync, onError)
  const ordered = [...active].sort((a, b) => levelRank(b) - levelRank(a) || a.name.localeCompare(b.name))
  const online = active.filter(device => device.online)
  const summary = [
    { key: 'danger', label: 'Peligro', count: online.filter(device => device.reading?.level === 'danger').length },
    { key: 'caution', label: 'Precaución', count: online.filter(device => device.reading?.level === 'caution').length },
    { key: 'normal', label: 'Normal', count: online.filter(device => device.reading?.level === 'normal').length },
    { key: 'offline', label: 'Sin conexión', count: active.length - online.length },
  ]

  if (!active.length) {
    return (
      <section className="panel">
        <Empty
          title="Sin manillas habilitadas"
          text="Registra una manilla para ver sus lecturas en tiempo real."
          action={<button className="button secondary" onClick={() => navigate('devices')}>Ir a manillas</button>}
        />
      </section>
    )
  }
  return (
    <>
      <div className="live-toolbar">
        <ul className="live-summary" aria-label="Manillas por nivel">
          {summary.map(item => (
            <li key={item.key} className={`${item.key} ${item.count ? 'active' : ''}`}>
              <span className="live-summary-mark" aria-hidden="true" />
              <span>{item.label}</span>
              <strong className="mono">{item.count}</strong>
            </li>
          ))}
        </ul>
        <div className="live-legend" role="note">
          <Radio size={15} aria-hidden="true" />
          <span>Cada lectura aparece en cuanto llega de la manilla. Las curvas muestran los últimos 10 minutos de lecturas de cada manilla.</span>
        </div>
      </div>
      <div className="live-grid">
        {ordered.map(device => <LiveCard key={device.id} device={device} readings={series[device.id] ?? NO_READINGS} inspect={inspect} />)}
      </div>
      <p className="live-note">
        <CircleHelp size={15} aria-hidden="true" />
        El CO se informa en ppm solo con el sensor calibrado; sin calibración se muestra su tensión. Los niveles los calcula la manilla con sus umbrales.
      </p>
    </>
  )
}

// A reading re-renders only its own card; the clock re-renders the card only when it turns stale.
const LiveCard = memo(function LiveCard({ device, readings, inspect }: { device: Device; readings: Reading[]; inspect: (device: Device) => void }) {
  const reading = readings.at(-1) ?? device.reading
  const stale = useNowCheck(now => !reading || now - parseDate(reading.receivedAt).getTime() > STALE_MS)
  const level = reading?.level ?? 'normal'
  const uncalibrated = isUncalibrated(reading)
  const curves = useMemo(() => {
    const newest = readings.length ? parseDate(readings[readings.length - 1].receivedAt).getTime() : 0
    const recent = readings
      .map(item => ({ item, time: parseDate(item.receivedAt).getTime() }))
      .filter(({ time }) => newest - time <= LIVE_WINDOW_MS)
    const points = (pick: (reading: Reading) => number | null): ChartPoint[] => recent.map(({ item, time }) => ({ time, value: pick(item) }))
    return {
      gas: points(uncalibrated ? item => item.gasVoltage : item => item.gasPpm),
      ambient: points(item => item.temperatureC),
      object: points(item => item.objectTemperatureC),
    }
  }, [readings, uncalibrated])

  return (
    <article className={`live-card ${level} ${stale ? 'stale' : ''} ${device.online ? '' : 'offline'}`} aria-label={`Lecturas en vivo de ${device.name}`}>
      <header>
        <div className="live-identity">
          <strong>{device.minerName ?? 'Sin asignar'}</strong>
          <small>{device.name} · {device.zone}</small>
        </div>
        <div className="live-status">
          {reading && <LevelBadge level={level} />}
          <DeviceStatus device={device} />
        </div>
      </header>
      <div className="live-metrics">
        <LiveMetric
          icon={Wind}
          label={isUncalibrated(reading) ? 'CO (sin calibrar)' : 'CO'}
          value={gas(reading)}
          points={curves.gas}
        />
        <LiveMetric icon={Thermometer} label="Ambiente" value={temperature(reading?.temperatureC)} points={curves.ambient} />
        <LiveMetric icon={Thermometer} label="Objeto" value={temperature(reading?.objectTemperatureC)} points={curves.object} />
      </div>
      <footer>
        <div className="live-footer-info">
          <Freshness reading={reading} stale={stale} />
          <span className="live-battery">
            <Battery size={15} aria-hidden="true" />
            Batería: {reading?.batteryPercent == null ? 'Sin sensor' : percent(reading.batteryPercent)}
          </span>
        </div>
        <button className="text-button" onClick={() => inspect(device)}>Ver gráfico<ChevronRight size={15} /></button>
      </footer>
    </article>
  )
})

const NO_READINGS: Reading[] = []

// The only part of a card that changes every second.
function Freshness({ reading, stale }: { reading: Reading | null | undefined; stale: boolean }) {
  const now = useNow()
  return (
    <span className={`live-freshness ${stale ? 'stale' : ''}`}>
      <span className="live-freshness-dot" aria-hidden="true" />
      {!reading ? 'Esperando la primera lectura' : stale ? `Última lectura ${elapsed(reading.receivedAt, now)}` : `Actualizado ${elapsed(reading.receivedAt, now)}`}
      <ReadingOrigin reading={reading} />
    </span>
  )
}

// One instrument row: label, ten-minute trend and the current value, aligned for scanning.
function LiveMetric({ icon: Icon, label, value, points }: { icon: LucideIcon; label: string; value: string; points: ChartPoint[] }) {
  return (
    <div className="live-metric">
      <span className="live-metric-label"><Icon size={14} aria-hidden="true" />{label}</span>
      <Sparkline points={points} label={`Tendencia de ${label.toLowerCase()}`} />
      <strong className="mono">{value}</strong>
    </div>
  )
}

// Loads the stored part of the last ten minutes once per device, and again after a reconnection.
function useSeedLiveSeries(devices: Device[], seed: (deviceId: string, readings: Reading[]) => void, resync: number, onError: (error: unknown) => void) {
  const seeded = useRef(new Map<string, number>())
  const ids = devices.map(device => device.id).join(',')
  useEffect(() => {
    const done = seeded.current
    const controller = new AbortController()
    const pending = new Set<string>()
    const since = new Date(Date.now() - LIVE_WINDOW_MS).toISOString()
    for (const id of ids ? ids.split(',') : []) {
      if (done.get(id) === resync) continue
      done.set(id, resync)
      pending.add(id)
      devicesApi.telemetry(id, { since, limit: 600 }, controller.signal)
        .then(readings => {
          pending.delete(id)
          seed(id, readings)
        })
        .catch(error => {
          if (controller.signal.aborted) return
          // Retried on the next render or reconnection.
          pending.delete(id)
          done.delete(id)
          if (!isTransient(error)) onError(error)
        })
    }
    return () => {
      controller.abort()
      for (const id of pending) done.delete(id)
    }
  }, [ids, resync, seed, onError])
}
