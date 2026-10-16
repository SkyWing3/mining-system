import { useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, ArrowLeft, Megaphone } from 'lucide-react'
import { noticesApi } from '../../api/endpoints'
import type { Device, NoticeKind } from '../../types/domain'
import { ApplicationForm, Select } from '../ui/controls'
import { Modal } from '../ui/Modal'

const ALL = '__all__'
const ZONE = 'zone:'

// Nothing is preselected: a notice can't be retracted, so the operator always chooses what and to whom.
// A critical notice, or one for several manillas, takes an explicit confirmation step.
export function NoticeForm({ catalog, devices, initialDeviceId, close, sent }: {
  catalog: NoticeKind[]
  devices: Device[]
  initialDeviceId?: string
  close: () => void
  sent: (count: number) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [code, setCode] = useState('')
  const [target, setTarget] = useState(initialDeviceId ?? '')
  const [confirming, setConfirming] = useState(false)
  const targets = devices.filter(device => device.active)
  const zones = [...new Set(targets.map(device => device.zone))]
  const kind = catalog.find(item => item.code === code)
  const recipients = target === ALL
    ? targets
    : target.startsWith(ZONE) ? targets.filter(device => device.zone === target.slice(ZONE.length)) : targets.filter(device => device.id === target)
  const needsConfirmation = kind?.severity === 'critical' || recipients.length > 1
  const count = recipients.length === 1 ? 'la manilla' : `${recipients.length} manillas`

  function choose(setter: (value: string) => void) {
    return (value: string) => {
      setter(value)
      setConfirming(false)
      setError('')
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const pickers = form.querySelectorAll<HTMLElement>('[role="combobox"]')
    if (!kind) {
      setError('Elige el aviso que verá el minero.')
      pickers[0]?.focus()
      return
    }
    if (!recipients.length) {
      setError('Elige a qué manillas se envía el aviso.')
      pickers[1]?.focus()
      return
    }
    if (needsConfirmation && !confirming) {
      setError('')
      setConfirming(true)
      return
    }
    setBusy(true)
    setError('')
    try {
      const created = await noticesApi.send(target === ALL ? { code, all: true } : { code, deviceIds: recipients.map(device => device.id) })
      sent(created.length)
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Enviar aviso" subtitle="La manilla lo muestra en la OLED con vibración, sonido y luz." close={close}>
      <ApplicationForm className="dialog-form" onSubmit={submit}>
        <Select
          label="Aviso"
          name="code"
          value={code}
          onChange={choose(setCode)}
          options={[{ value: '', label: 'Elige un aviso' }, ...catalog.map(item => ({ value: item.code, label: item.text }))]}
        />
        <Select
          label="Destino"
          name="target"
          value={target}
          onChange={choose(setTarget)}
          options={[
            { value: '', label: 'Elige el destino' },
            { value: ALL, label: `Todas las manillas habilitadas (${targets.length})` },
            ...zones.map(zone => {
              const size = targets.filter(device => device.zone === zone).length
              return { value: ZONE + zone, label: `Zona ${zone} (${size} ${size === 1 ? 'manilla' : 'manillas'})` }
            }),
            ...targets.map(device => ({ value: device.id, label: `${device.name} · ${device.minerName ?? 'Sin asignar'}` })),
          ]}
        />
        {confirming && kind ? (
          <div className={`notice-confirm ${kind.severity === 'critical' ? 'critical' : ''}`} role="status">
            <strong>Vas a enviar «{kind.text}» a {count}.</strong>
            <p>
              {recipients.slice(0, 6).map(device => `${device.name} · ${device.minerName ?? 'Sin asignar'}`).join(', ')}
              {recipients.length > 6 && ` y ${recipients.length - 6} más`}.
            </p>
            <p>Un aviso enviado no se puede retirar. Cada minero lo confirma con Enter en su manilla.</p>
          </div>
        ) : (
          <p className="form-hint">
            Las manillas sin conexión lo reciben al reconectarse, mientras el aviso no caduque. El minero lo confirma con Enter y su lectura queda registrada.
          </p>
        )}
        {error && <div className="form-error" role="alert"><AlertCircle size={16} aria-hidden="true" />{error}</div>}
        <div className="modal-actions">
          {confirming ? (
            <>
              <button className="button secondary" type="button" onClick={() => setConfirming(false)}><ArrowLeft size={16} />Volver</button>
              <button className={`button ${kind?.severity === 'critical' ? 'danger' : 'primary'}`} disabled={busy}>
                <Megaphone size={16} />{busy ? 'Enviando…' : `Confirmar envío a ${count}`}
              </button>
            </>
          ) : (
            <>
              <button className="button secondary" type="button" onClick={close}>Cancelar</button>
              <button className="button primary" disabled={busy || !targets.length}><Megaphone size={16} />{busy ? 'Enviando…' : 'Enviar aviso'}</button>
            </>
          )}
        </div>
      </ApplicationForm>
    </Modal>
  )
}
