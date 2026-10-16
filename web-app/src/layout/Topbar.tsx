import { useEffect, useState } from 'react'
import { ArrowRight, Bell, CheckCheck, ChevronRight, Clock3, Menu, TriangleAlert, X } from 'lucide-react'
import type { User } from '../types/domain'
import { initials, longDate } from '../utils/format'

export function Topbar({ user, title, pendingAlerts, openNavigation, showAlerts }: {
  user: User
  title: string
  pendingAlerts: number
  openNavigation: () => void
  showAlerts: () => void
}) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  return (
    <header className="topbar">
      <div className="topbar-location">
        <button className="icon-button mobile-menu" aria-label="Abrir navegación" onClick={openNavigation}><Menu size={21} /></button>
        <span>Central</span>
        <ChevronRight size={14} />
        <strong>{title}</strong>
      </div>
      <div className="topbar-right">
        <span className="topbar-date"><Clock3 size={15} />{longDate(now)}</span>
        <span className="topbar-divider" />
        <button className="notification-button" aria-label={`Ver alertas: ${pendingAlerts} pendientes`} onClick={showAlerts}>
          <Bell size={19} />
          {pendingAlerts > 0 && <span />}
        </button>
        <span className="avatar small">{initials(user.name)}</span>
      </div>
    </header>
  )
}

export function Toast({ text, critical, action, close }: { text: string; critical: boolean; action?: { label: string; run: () => void }; close: () => void }) {
  useEffect(() => {
    if (critical) return
    const timer = setTimeout(close, 7000)
    return () => clearTimeout(timer)
  }, [critical, close, text])

  return (
    <div className={`toast ${critical ? 'critical' : ''}`} role={critical ? 'alert' : 'status'}>
      <ToastIcon critical={critical} />
      <span>{text}</span>
      {action && <button className="text-button" onClick={action.run}>{action.label}<ArrowRight size={15} /></button>}
      <button className="icon-button" aria-label="Cerrar notificación" onClick={close}><X size={17} /></button>
    </div>
  )
}


function ToastIcon({ critical }: { critical: boolean }) {
  return critical ? <TriangleAlert size={20} /> : <CheckCheck size={20} />
}
