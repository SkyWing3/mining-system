import { useEffect, useRef, useState } from 'react'
import { Battery, ChevronRight, CircleHelp, HardHat, Radio, Thermometer, Wind } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { devicesApi } from '../api/endpoints'
import { isTransient } from '../api/client'
import { DeviceStatus, LevelBadge, SimulatedTag } from '../components/devices/DeviceIndicators'
import { Sparkline } from '../components/telemetry/LineChart'
import type { ChartPoint } from '../components/telemetry/LineChart'
import { Empty } from '../components/ui/Feedback'
import { LIVE_WINDOW_MS } from '../realtime/liveTelemetry'
import type { LiveSeries } from '../realtime/liveTelemetry'
import type { Device, Page, Reading } from '../types/domain'
import { elapsed, gas, isUncalibrated, parseDate, percent, temperature } from '../utils/format'

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
  const now = useNow()
  useSeedLiveSeries(active, seed, resync, onError)
  const ordered = [...active].sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name))

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
      <div className="live-legend" role="note">
        <Radio size={15} />
        <span>Lecturas recibidas por WebSocket a medida que llegan. Las curvas muestran los últimos 10 minutos.</span>
      </div>
      <div className="live-grid">
        {ordered.map(device => <LiveCard key={device.id} device={device} readings={series[device.id] ?? []} now={now} inspect={inspect} />)}
      </div>
      <p className="panel-bottom-note live-note">
        <CircleHelp size={15} />
        El CO se informa en ppm solo con el sensor calibrado; sin calibración se muestra su tensión. Los niveles los calcula la manilla con sus umbrales.
      </p>
    </>
  )
}

function rank(device: Device) {
  return { danger: 2, caution: 1, normal: 0 }[device.reading?.level ?? 'normal'] + (device.online ? 0.5 : 0)
}

function LiveCard({ device, readings, now, inspect }: { device: Device; readings: Reading[]; now: number; inspect: (device: Device) => void }) {
  const reading = readings.at(-1) ?? device.reading
  const stale = !reading || now - parseDate(reading.receivedAt).getTime() > STALE_MS
  const recent = readings.filter(item => now - parseDate(item.receivedAt).getTime() <= LIVE_WINDOW_MS)
  const points = (pick: (reading: Reading) => number | null): ChartPoint[] =>
    recent.map(item => ({ time: parseDate(item.receivedAt).getTime(), value: pick(item) }))
  const level = reading?.level ?? 'normal'

  return (
    <article className={`live-card ${level} ${stale ? 'stale' : ''}`} aria-label={`Lecturas en vivo de ${device.name}`}>
      <header>
        <span className="avatar neutral"><HardHat size={20} strokeWidth={1.6} /></span>
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
          points={points(isUncalibrated(reading) ? item => item.gasVoltage : item => item.gasPpm)}
        />
        <LiveMetric icon={Thermometer} label="Ambiente" value={temperature(reading?.temperatureC)} points={points(item => item.temperatureC)} />
        <LiveMetric icon={Thermometer} label="Objeto" value={temperature(reading?.objectTemperatureC)} points={points(item => item.objectTemperatureC)} />
        <LiveMetric icon={Battery} label="Batería" value={reading?.batteryPercent == null ? 'Sin sensor' : percent(reading.batteryPercent)} />
      </div>
      <footer>
        <span className={`live-freshness ${stale ? 'stale' : ''}`}>
          {reading ? `${stale ? 'Sin datos recientes · ' : ''}Actualizado ${elapsed(reading.receivedAt, now)}` : 'Esperando la primera lectura'}
          {reading?.simulated && <SimulatedTag />}
        </span>
        <button className="text-button" onClick={() => inspect(device)}>Ver gráfico<ChevronRight size={15} /></button>
      </footer>
    </article>
  )
}

function LiveMetric({ icon: Icon, label, value, points }: { icon: LucideIcon; label: string; value: string; points?: ChartPoint[] }) {
  return (
    <div className="live-metric">
      <span className="live-metric-label"><Icon size={14} />{label}</span>
      <strong>{value}</strong>
      {points && <Sparkline points={points} label={`Tendencia de ${label.toLowerCase()}`} />}
    </div>
  )
}

function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return now
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
