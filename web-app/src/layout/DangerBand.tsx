import { ArrowRight, OctagonAlert } from 'lucide-react'
import type { LiveSeries } from '../realtime/liveTelemetry'
import type { Device, Page, Reading } from '../types/domain'
import { date, gas, temperature } from '../utils/format'

// Start of the current danger streak in the readings this central has seen. When the streak reaches the
// oldest reading we hold, the real start is earlier, so it is reported as "al menos desde".
function dangerSince(device: Device, readings: Reading[]) {
  let index = readings.length - 1
  if (index < 0 || readings[index].level !== 'danger') return device.reading ? { time: device.reading.receivedAt, observed: false } : null
  while (index > 0 && readings[index - 1].level === 'danger') index--
  return { time: readings[index].receivedAt, observed: index > 0 }
}

// Persistent alarm on every page while a manilla reports danger, or reported it and then lost its signal.
export function DangerBand({ current, lost, series, visible, inspect, navigate }: {
  current: Device[]
  lost: Device[]
  series: LiveSeries
  visible: boolean
  inspect: (device: Device) => void
  navigate: (page: Page) => void
}) {
  const devices = [...current, ...lost]
  const first = devices[0]
  const others = devices.length - 1
  // Announced once per change of the affected manillas, not on every reading.
  const announcement = devices.map(device => `${device.minerName ?? 'Sin asignar'}, ${device.name}, ${device.zone}${lost.includes(device) ? ', sin señal' : ''}`).join('; ')
  const since = first && !lost.includes(first) ? dangerSince(first, series[first.id] ?? []) : null
  return (
    <>
      <div className="sr-only" role="alert">{announcement && `Peligro: ${announcement}.`}</div>
      {visible && first && (
        <div className="danger-band">
          <OctagonAlert size={20} strokeWidth={2.2} aria-hidden="true" />
          <div className="danger-band-text">
            <strong>Peligro</strong>
            <span className="danger-band-who">{first.minerName ?? 'Sin asignar'} · {first.name} · {first.zone}</span>
            {lost.includes(first) ? (
              <span>Sin señal desde las <span className="mono">{date(first.lastSeenAt)}</span> · último nivel informado: peligro</span>
            ) : (
              <span className="mono">CO {gas(first.reading)} · Ambiente {temperature(first.reading?.temperatureC)}</span>
            )}
            {since && <span>{since.observed ? 'desde las ' : 'al menos desde las '}<span className="mono">{date(since.time)}</span></span>}
            {others > 0 && <span>+{others} {others === 1 ? 'manilla' : 'manillas'} más</span>}
          </div>
          <div className="danger-band-actions">
            <button className="button danger-inverse small-button" onClick={() => inspect(first)}>Ver lecturas de {first.name}</button>
            {others > 0 && <button className="text-button" onClick={() => navigate('live')}>Ver todas<ArrowRight size={14} /></button>}
          </div>
        </div>
      )}
    </>
  )
}
