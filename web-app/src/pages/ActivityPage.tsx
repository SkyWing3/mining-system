import { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import { loadWithRecovery } from '../api/client'
import { monitoringApi } from '../api/endpoints'
import { Empty, PanelHeading } from '../components/ui/Feedback'
import type { AuditEvent } from '../types/domain'
import { date } from '../utils/format'

export function ActivityPage({ version, onError }: { version: number; onError: (error: unknown) => void }) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  useEffect(() => loadWithRecovery(signal => monitoringApi.events(signal), setEvents, onError), [version, onError])
  return (
    <section className="panel">
      <PanelHeading title="Registro de la central" subtitle="Las 100 acciones más recientes, con su autor y fecha" />
      {events.length ? (
        <div className="activity-list">
          {events.map(event => (
            <article className="activity-row" key={event.id}>
              <span className="activity-icon"><Activity size={17} /></span>
              <div><strong>{event.actor}</strong><p>{event.description}</p></div>
              <time>{date(event.createdAt, true)}</time>
            </article>
          ))}
        </div>
      ) : <Empty title="Sin actividad registrada" text="Las acciones de administración aparecerán aquí." />}
    </section>
  )
}
