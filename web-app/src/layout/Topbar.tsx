import { memo, useEffect } from 'react'
import { ArrowRight, Bell, CheckCheck, Menu, OctagonAlert, Radio, TriangleAlert, X } from 'lucide-react'
import { Chip } from '../components/ui/Feedback'
import { useNow } from '../realtime/clock'
import { presenceKnown } from '../realtime/LinkContext'
import type { LinkStatus } from '../realtime/useRealtime'
import type { User } from '../types/domain'
import { clock, initials, shortDate } from '../utils/format'

const linkLabel: Record<LinkStatus, string> = { online: 'En línea', starting: 'Conectando…', connecting: 'Conectando…', offline: 'Sin enlace' }

// Always-visible status strip: live link, connected manillas, danger and the central's clock.
// Memoized: a reading re-renders it only when one of its counts changes.
export const Topbar = memo(function Topbar({ user, connection, loaded, online, active, liveDanger, pendingAlerts, openNavigation, showAlerts }: {
  user: User
  connection: LinkStatus
  loaded: boolean
  online: number
  active: number
  liveDanger: number
  pendingAlerts: number
  openNavigation: () => void
  showAlerts: () => void
}) {
  const known = presenceKnown(connection)
  return (
    <header className="topbar">
      <div className="topbar-status">
        <button className="icon-button mobile-menu" aria-label="Abrir navegación" onClick={openNavigation}><Menu size={21} /></button>
        <span className={`link-indicator ${connection === 'starting' ? 'connecting' : connection}`}>
          <span className="link-dot" aria-hidden="true" />
          <span className="link-label">Enlace en vivo</span>
          <strong>{linkLabel[connection]}</strong>
        </span>
        <span className="topbar-divider" aria-hidden="true" />
        <span className="topbar-metric">
          <Radio size={15} aria-hidden="true" />
          {/* Without the live link, presence is the last data received, not a current count. */}
          <strong className="mono">{!loaded ? '—' : `${known ? online : '—'}/${active}`}</strong>
          <span>{!loaded ? 'cargando manillas…' : known ? 'manillas conectadas' : 'manillas · estado desconocido'}</span>
        </span>
        {liveDanger > 0 && (
          <Chip tone="danger" className="topbar-danger" icon={<OctagonAlert size={14} aria-hidden="true" />}>
            {liveDanger}<span className="topbar-danger-noun">{liveDanger === 1 ? ' manilla' : ' manillas'}</span> en peligro
          </Chip>
        )}
      </div>
      <div className="topbar-right">
        <CentralClock />
        <span className="topbar-divider" aria-hidden="true" />
        <button className={`notification-button ${pendingAlerts > 0 ? 'pending' : ''}`} aria-label={`Ver alertas: ${pendingAlerts} pendientes`} onClick={showAlerts}>
          <Bell size={19} />
          {pendingAlerts > 0 && <span className="notification-count mono" aria-hidden="true">{pendingAlerts > 99 ? '99+' : pendingAlerts}</span>}
        </button>
        <span className="avatar small" aria-hidden="true">{initials(user.name)}</span>
      </div>
    </header>
  )
})

function CentralClock() {
  const now = new Date(useNow())
  return (
    <div className="topbar-clock" aria-label={`Hora de la central: ${clock(now)}`}>
      <strong className="mono">{clock(now)}</strong>
      <small>{shortDate(now)} · Bolivia</small>
    </div>
  )
}

export function Toast({ text, critical, more = 0, action, close }: {
  text: string
  critical: boolean
  more?: number
  action?: { label: string; run: () => void }
  close: () => void
}) {
  useEffect(() => {
    if (critical) return
    const timer = setTimeout(close, 7000)
    return () => clearTimeout(timer)
  }, [critical, close, text])

  return (
    <div className={`toast ${critical ? 'critical' : ''}`} role={critical ? 'alert' : 'status'}>
      <span className="toast-icon" aria-hidden="true">{critical ? <TriangleAlert size={18} /> : <CheckCheck size={18} />}</span>
      <span className="toast-text">{text}{more > 0 && <small>+{more} {more === 1 ? 'alerta más' : 'alertas más'}</small>}</span>
      {action && <button className="text-button" onClick={action.run}>{action.label}<ArrowRight size={15} /></button>}
      <button className="icon-button" aria-label={more > 0 ? 'Cerrar notificaciones de alerta' : 'Cerrar notificación'} onClick={close}><X size={17} /></button>
    </div>
  )
}
