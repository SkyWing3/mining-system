import { CircleCheck, OctagonAlert, TriangleAlert } from 'lucide-react'
import type { AlertLevel, Device } from '../../types/domain'
import { levelName } from '../../utils/format'

export function DeviceStatus({ device }: { device: Device }) {
  const state = !device.active ? 'disabled' : device.online ? 'online' : 'offline'
  const label = !device.active ? 'Deshabilitada' : device.online ? 'Conectada' : 'Sin conexión'
  return <span className={`device-status ${state}`}><span />{label}</span>
}

const levelIcons = { normal: CircleCheck, caution: TriangleAlert, danger: OctagonAlert }

// Alert levels always show an icon and a label, never color alone.
export function LevelBadge({ level }: { level: AlertLevel }) {
  const Icon = levelIcons[level]
  return <span className={`level-badge ${level}`}><Icon size={13} strokeWidth={2.2} aria-hidden="true" />{levelName[level]}</span>
}

export function SimulatedTag() {
  return <span className="simulated-tag">Simulado</span>
}
