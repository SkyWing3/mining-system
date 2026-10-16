import { useEffect, useState } from 'react'
import { Download, Radio } from 'lucide-react'
import { loadWithRecovery } from '../api/client'
import { monitoringApi } from '../api/endpoints'
import { MessageRows } from '../components/messages/MessageRows'
import { Empty, Pagination, Spinner } from '../components/ui/Feedback'
import { SearchField, Select } from '../components/ui/controls'
import type { Device, Message, PagedResult } from '../types/domain'
import { date, plural } from '../utils/format'

const PAGE_SIZE = 25

export function MessagesPage({ alerts, version, devices, review, onError }: {
  alerts: boolean
  version: number
  devices: Device[]
  review: (message: Message) => void
  onError: (error: unknown) => void
}) {
  const [search, setSearch] = useState('')
  const [severity, setSeverity] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [pending, setPending] = useState(true)
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<PagedResult<Message> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => loadWithRecovery(
    signal => {
      setLoading(true)
      return monitoringApi.messages({
        page,
        pageSize: PAGE_SIZE,
        search,
        severity: alerts ? 'critical' : severity,
        deviceId,
        pending: alerts && pending,
      }, signal)
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
    search ? 250 : 100,
  ), [search, severity, deviceId, pending, alerts, page, version, onError])

  // Filters always return to the first page.
  function filter<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value)
      setPage(1)
    }
  }

  const filtered = search || deviceId || severity
  return (
    <section className="panel messages-panel">
      <div className="message-toolbar">
        {alerts && (
          <div className="tabs">
            <button className={pending ? 'selected' : ''} onClick={() => filter(setPending)(true)}>Pendientes</button>
            <button className={!pending ? 'selected' : ''} onClick={() => filter(setPending)(false)}>Todas las alertas</button>
          </div>
        )}
        <SearchField label="Buscar mensajes" value={search} onChange={filter(setSearch)} placeholder="Buscar mensaje, minero o zona…" />
        {!alerts && (
          <Select
            aria-label="Filtrar prioridad"
            value={severity}
            onChange={filter(setSeverity)}
            options={[
              { value: '', label: 'Todas las prioridades' },
              { value: 'critical', label: 'Críticas' },
              { value: 'warning', label: 'Atención' },
              { value: 'info', label: 'Informativas' },
            ]}
          />
        )}
        <Select
          aria-label="Filtrar manilla"
          value={deviceId}
          onChange={filter(setDeviceId)}
          options={[{ value: '', label: 'Todas las manillas' }, ...devices.map(device => ({ value: device.id, label: device.name }))]}
        />
        <button className="button secondary export-button" disabled={!result?.items.length || loading || !!error} onClick={() => exportCsv(result?.items ?? [], page)}>
          <Download size={16} />Exportar página
        </button>
      </div>
      <div className="message-inbox-heading">
        <span>{alerts ? 'REPORTES CRÍTICOS' : 'BANDEJA DE ENTRADA'} <b>{result?.total ?? 0}</b></span>
        <span><Radio size={14} />Recepción desde las manillas</span>
      </div>
      {error ? <Empty title="No se pudo actualizar la bandeja" text={error} />
        : loading && !result ? <Spinner label="Cargando mensajes…" />
        : result?.items.length ? <MessageRows messages={result.items} review={review} />
        : (
          <Empty
            title={alerts ? 'Sin alertas en esta vista' : 'Sin mensajes en esta vista'}
            text={filtered
              ? 'Prueba otros filtros para encontrar los reportes.'
              : alerts ? 'Aquí aparecerán los reportes críticos enviados por tu equipo.' : 'Los mensajes predeterminados aparecerán cuando una manilla los envíe.'}
          />
        )}
      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={result?.total ?? 0}
        loading={loading}
        onChange={setPage}
        summary={<>{alerts ? plural(result?.total ?? 0, 'alerta', 'alertas') : plural(result?.total ?? 0, 'mensaje', 'mensajes')}<span className="dot-separator">·</span>Solo recepción</>}
      />
    </section>
  )
}

function exportCsv(items: Message[], page: number) {
  const rows = [
    ['ID', 'Mensaje', 'Detalle', 'Prioridad', 'Minero', 'Manilla', 'Zona', 'Enviado', 'Recibido', 'Revisado por'],
    ...items.map(item => [String(item.id), item.text, item.detail ?? '', item.severity, item.minerName, item.deviceName, item.zone,
      date(item.sentAt, true), date(item.receivedAt, true), item.reviewedBy ?? '']),
  ]
  // Cells starting with = + - @ are prefixed so spreadsheets never evaluate them as formulas.
  const csv = '﻿' + rows.map(row => row.map(cell => `"${(/^[=+\-@]/.test(cell) ? "'" : '') + cell.replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `mining-mensajes-pagina-${page}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}
