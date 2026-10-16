import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import type { Severity } from '../../types/domain'
import { severityName } from '../../utils/format'

// Safety tones carry meaning (precaución, peligro); the rest are neutral variants. Normal stays quiet (outline).
export type Tone = 'warn' | 'danger' | 'neutral' | 'outline' | 'dashed' | 'solid' | 'brand'

// One compact label for every state in the central: always text, never color alone.
export function Chip({ tone = 'neutral', icon, dot = false, className = '', children }: {
  tone?: Tone
  icon?: ReactNode
  dot?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <span className={`chip ${tone} ${className}`.trim()}>
      {dot && <span className="chip-dot" aria-hidden="true" />}
      {icon}
      {children}
    </span>
  )
}

const severityTone: Record<Severity, Tone> = { critical: 'danger', warning: 'warn', info: 'outline' }

export function Badge({ severity }: { severity: Severity }) {
  return <Chip tone={severityTone[severity]} className={`badge ${severity}`}>{severityName[severity]}</Chip>
}

export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Inbox size={22} strokeWidth={1.6} aria-hidden="true" /></span>
      <p className="empty-title">{title}</p>
      <p>{text}</p>
      {action}
    </div>
  )
}

export function PanelHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// Thin strip above a list: what it contains, how many items, and where they come from.
export function SectionBar({ label, count, meta }: { label: string; count: number; meta?: ReactNode }) {
  return (
    <div className="section-bar">
      <span>{label}<b className="mono">{count}</b></span>
      {meta && <span className="section-bar-meta">{meta}</span>}
    </div>
  )
}

// One cell of the overview strip. `alert` only applies while there is something to attend to.
export function Stat({ label, value, icon, note, alert = false, meter }: {
  label: string
  value: ReactNode
  icon: ReactNode
  note: string
  alert?: boolean
  meter?: number
}) {
  return (
    <article className={`stat-card ${alert ? 'alert' : ''}`}>
      <div className="stat-top"><span className="stat-icon" aria-hidden="true">{icon}</span><span>{label}</span></div>
      <div className="stat-number mono">{value}</div>
      {meter !== undefined && <span className="stat-meter" aria-hidden="true"><span style={{ width: `${Math.round(meter * 100)}%` }} /></span>}
      <p>{note}</p>
    </article>
  )
}

export function Spinner({ label }: { label: string }) {
  return <div className="loading-panel" role="status"><span className="spinner" aria-hidden="true" />{label}</div>
}

export function Pagination({ page, pageSize, total, loading, summary, onChange }: {
  page: number
  pageSize: number
  total: number
  loading: boolean
  summary: ReactNode
  onChange: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="pagination">
      <span>{loading ? 'Actualizando…' : summary}</span>
      <div>
        <button className="icon-button" aria-label="Página anterior" disabled={page <= 1 || loading} onClick={() => onChange(page - 1)}>
          <ChevronLeft size={18} />
        </button>
        <span className="mono">Página {page} de {pages}</span>
        <button className="icon-button" aria-label="Página siguiente" disabled={page >= pages || loading} onClick={() => onChange(page + 1)}>
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}
