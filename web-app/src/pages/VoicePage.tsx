import { useEffect, useState } from 'react'
import { CheckCheck, Mic } from 'lucide-react'
import { loadWithRecovery } from '../api/client'
import { voiceApi } from '../api/endpoints'
import { Chip, Empty, Pagination, SectionBar, Spinner } from '../components/ui/Feedback'
import { Select } from '../components/ui/controls'
import { VoicePlayer } from '../components/voice/VoicePlayer'
import type { Device, PagedResult, VoiceMessage } from '../types/domain'
import { date, duration, initials, plural } from '../utils/format'

const PAGE_SIZE = 20

export function VoicePage({ version, devices, onError }: { version: number; devices: Device[]; onError: (error: unknown) => void }) {
  const [pending, setPending] = useState(true)
  const [deviceId, setDeviceId] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<PagedResult<VoiceMessage> | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => loadWithRecovery(
    signal => {
      setLoading(true)
      return voiceApi.list({ page, pageSize: PAGE_SIZE, pending, deviceId }, signal)
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
  ), [pending, deviceId, page, version, onError])

  async function review(voice: VoiceMessage) {
    setBusy(voice.id)
    try {
      const reviewed = await voiceApi.review(voice.id)
      setResult(current => current && { ...current, items: current.items.map(item => (item.id === reviewed.id ? reviewed : item)) })
    } catch (failure) {
      onError(failure)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="panel">
      <div className="message-toolbar">
        <div className="tabs" role="group" aria-label="Estado de escucha">
          <button className={pending ? 'selected' : ''} aria-pressed={pending} onClick={() => { setPending(true); setPage(1) }}>Sin escuchar</button>
          <button className={!pending ? 'selected' : ''} aria-pressed={!pending} onClick={() => { setPending(false); setPage(1) }}>Todos</button>
        </div>
        <Select
          aria-label="Filtrar manilla de voz"
          value={deviceId}
          onChange={value => { setDeviceId(value); setPage(1) }}
          options={[{ value: '', label: 'Todas las manillas' }, ...devices.map(device => ({ value: device.id, label: device.name }))]}
        />
      </div>
      <SectionBar label="Mensajes de voz" count={result?.total ?? 0} meta={<><Mic size={14} aria-hidden="true" />Micrófono INMP441 de las manillas</>} />
      {error ? <Empty title="No se pudo cargar la voz" text={error} />
        : loading && !result ? <Spinner label="Cargando mensajes de voz…" />
        : result?.items.length ? (
          <div className="voice-list">
            {result.items.map(voice => (
              <article className="voice-row" key={voice.id}>
                <span className={`voice-mark ${voice.reviewedAt ? '' : 'pending'}`} aria-hidden="true">{initials(voice.minerName)}</span>
                <div className="voice-body">
                  <strong>{voice.minerName}</strong>
                  <small>{voice.deviceName} · {voice.zone} · <span className="mono">{date(voice.receivedAt, true)}</span></small>
                  <VoicePlayer
                    src={voiceApi.audioUrl(voice.id)}
                    durationMs={voice.durationMs}
                    label={`mensaje de ${voice.minerName}, ${duration(voice.durationMs)}`}
                  />
                </div>
                <div className="voice-end">
                  {voice.reviewedAt
                    ? <Chip tone="neutral" className="reviewed" icon={<CheckCheck size={13} aria-hidden="true" />}>Escuchado por {voice.reviewedBy}</Chip>
                    : (
                      <button className="button secondary small-button" disabled={busy === voice.id} onClick={() => void review(voice)}>
                        <CheckCheck size={15} />{busy === voice.id ? 'Guardando…' : 'Marcar como escuchado'}
                      </button>
                    )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title={pending ? 'Sin mensajes de voz pendientes' : 'Sin mensajes de voz'}
            text="Las grabaciones aparecerán aquí en cuanto una manilla las envíe."
          />
        )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={result?.total ?? 0} loading={loading} onChange={setPage} summary={plural(result?.total ?? 0, 'grabación', 'grabaciones')} />
    </section>
  )
}
