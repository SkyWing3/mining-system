import { useContext } from 'react'
import { CircleCheck, OctagonAlert, TriangleAlert } from 'lucide-react'
import { LinkContext, presenceKnown } from '../../realtime/LinkContext'
import type { AlertLevel, Device, Reading } from '../../types/domain'
import { levelName } from '../../utils/format'
import { Chip } from '../ui/Feedback'
import type { Tone } from '../ui/Feedback'

// Presence is shown by shape and text: filled dot connected, hollow without signal, square disabled,
// dashed while the central itself has no live link (the last known state may have changed).
export function DeviceStatus({ device }: { device: Device }) {
  const link = useContext(LinkContext)
  const state = !device.active ? 'disabled' : !presenceKnown(link) ? 'unknown' : device.online ? 'online' : 'offline'
  const label = { disabled: 'Deshabilitada', unknown: 'Estado desconocido', online: 'Conectada', offline: 'Sin conexión' }[state]
  return <span className={`device-status ${state}`}><span aria-hidden="true" />{label}</span>
}

const levelIcons = { normal: CircleCheck, caution: TriangleAlert, danger: OctagonAlert }
const levelTones: Record<AlertLevel, Tone> = { normal: 'outline', caution: 'warn', danger: 'danger' }

// Alert levels always show an icon and a label, never color alone.
export function LevelBadge({ level }: { level: AlertLevel }) {
  const Icon = levelIcons[level]
  return (
    <Chip tone={levelTones[level]} className={`level-badge ${level}`} icon={<Icon size={13} strokeWidth={2.2} aria-hidden="true" />}>
      {levelName[level]}
    </Chip>
  )
}

export function SimulatedTag() {
  return <Chip tone="dashed" className="simulated-tag">Simulado</Chip>
}

// Every view that shows a reading also shows where it came from.
export function ReadingOrigin({ reading }: { reading: Pick<Reading, 'simulated'> | null | undefined }) {
  return reading?.simulated ? <SimulatedTag /> : null
}
