import { useEffect, useState } from 'react'
import { Megaphone } from 'lucide-react'
import { loadWithRecovery } from '../api/client'
import { noticesApi } from '../api/endpoints'
import { Badge, Empty, Pagination, Spinner } from '../components/ui/Feedback'
import type { Notice, PagedResult } from '../types/domain'
import { date, noticeStatusName, plural } from '../utils/format'

const PAGE_SIZE = 25

export function NoticesPage({ version, compose, onError }: { version: number; compose: () => void; onError: (error: unknown) => void }) {
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<PagedResult<Notice> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => loadWithRecovery(
    signal => {
      setLoading(true)
      return noticesApi.list({ page, pageSize: PAGE_SIZE }, signal)
    },
    data => {
      setResult(data)
      setError('')
      setLoading(false)
    },
    failure => {
      setError((failure as Error).message)
      setLoading(false)
      onError(failure)
    },
  ), [page, version, onError])

  return (
    <section className="panel">
      {error ? <Empty title="No se pudieron cargar los avisos" text={error} />
        : loading && !result ? <Spinner label="Cargando avisos…" />
        : result?.items.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>AVISO</th><th>MANILLA / MINERO</th><th>ENVIADO</th><th>ESTADO</th></tr></thead>
              <tbody>
                {result.items.map(notice => (
                  <tr key={notice.id}>
                    <td className="cell-main" data-label="Aviso">
                      <div className="notice-cell"><strong>{notice.text}</strong><Badge severity={notice.severity} /></div>
                    </td>
                    <td className="cell-wrap" data-label="Manilla">
                      <div className="table-person">
                        <div><strong>{notice.deviceName}</strong><small>{notice.minerName ?? 'Sin asignar'} · {notice.zone}</small></div>
                      </div>
                    </td>
                    <td data-label="Enviado">
                      <div className="cell-stack">
                        <span>{date(notice.createdAt, true)}</span>
                        <span className="cell-note">por {notice.createdBy}</span>
                      </div>
                    </td>
                    <td data-label="Estado"><NoticeStatus notice={notice} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Sin avisos enviados"
            text="Envía un aviso para que las manillas lo muestren con vibración, sonido y luz."
            action={<button className="button primary" onClick={compose}><Megaphone size={16} />Enviar aviso</button>}
          />
        )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={result?.total ?? 0} loading={loading} onChange={setPage} summary={plural(result?.total ?? 0, 'aviso', 'avisos')} />
    </section>
  )
}

function NoticeStatus({ notice }: { notice: Notice }) {
  const detail = notice.status === 'read' ? notice.readAt : notice.status === 'delivered' ? notice.deliveredAt : notice.status === 'pending' ? notice.expiresAt : null
  return (
    <span className={`notice-status ${notice.status}`}>
      <span className="notice-status-label"><span />{noticeStatusName[notice.status]}</span>
      {detail && <small>{notice.status === 'pending' ? `Caduca ${date(detail)}` : date(detail)}</small>}
    </span>
  )
}
