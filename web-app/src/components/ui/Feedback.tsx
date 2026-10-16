import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import type { Severity } from '../../types/domain'
import { severityName } from '../../utils/format'

export function Badge({ severity }: { severity: Severity }) {
  return <span className={`badge ${severity}`}>{severityName[severity]}</span>
}

export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Inbox size={27} strokeWidth={1.4} /></span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}

export function PanelHeading({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  )
}

export function Stat({ label, value, icon, note, alert = false }: { label: string; value: ReactNode; icon: ReactNode; note: string; alert?: boolean }) {
  return (
    <article className={`stat-card ${alert ? 'alert' : ''}`}>
      <div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div>
      <div className="stat-number">{value}</div>
      <p>{alert && <span className="tiny-dot" />}{note}</p>
    </article>
  )
}

export function Spinner({ label }: { label: string }) {
  return <div className="loading-panel"><span className="spinner" />{label}</div>
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
        <span>Página {page} de {pages}</span>
        <button className="icon-button" aria-label="Página siguiente" disabled={page >= pages || loading} onClick={() => onChange(page + 1)}>
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}
