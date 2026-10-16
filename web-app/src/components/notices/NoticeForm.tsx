import { useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, Megaphone } from 'lucide-react'
import { noticesApi } from '../../api/endpoints'
import type { Device, NoticeKind } from '../../types/domain'
import { ApplicationForm, Select } from '../ui/controls'
import { Modal } from '../ui/Modal'

const ALL = '__all__'

export function NoticeForm({ catalog, devices, initialDeviceId, close, sent }: {
  catalog: NoticeKind[]
  devices: Device[]
  initialDeviceId?: string
  close: () => void
  sent: (count: number) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const targets = devices.filter(device => device.active)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const code = String(data.get('code'))
    const target = String(data.get('target'))
    setBusy(true)
    setError('')
    try {
      const created = await noticesApi.send(target === ALL ? { code, all: true } : { code, deviceIds: [target] })
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
        <Select label="Aviso" name="code" defaultValue={catalog[0]?.code} options={catalog.map(kind => ({ value: kind.code, label: kind.text }))} />
        <Select
          label="Destino"
          name="target"
          defaultValue={initialDeviceId ?? ALL}
          options={[
            { value: ALL, label: `Todas las manillas habilitadas (${targets.length})` },
            ...targets.map(device => ({ value: device.id, label: `${device.name} · ${device.minerName ?? 'Sin asignar'}` })),
          ]}
        />
        <p className="form-hint">
          Las manillas sin conexión lo reciben al reconectarse, mientras el aviso no caduque. El minero lo confirma con Enter y su lectura queda registrada.
        </p>
        {error && <div className="form-error" role="alert"><AlertCircle size={16} />{error}</div>}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={close}>Cancelar</button>
          <button className="button primary" disabled={busy || !targets.length}><Megaphone size={16} />{busy ? 'Enviando…' : 'Enviar aviso'}</button>
        </div>
      </ApplicationForm>
    </Modal>
  )
}
