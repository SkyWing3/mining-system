import { useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, Save } from 'lucide-react'
import { devicesApi } from '../api/endpoints'
import { ApplicationForm, Checkbox, Select, TextField } from '../components/ui/controls'
import { Modal } from '../components/ui/Modal'
import type { Device, User } from '../types/domain'

export function DeviceForm({ device, miners, close, saved }: { device: Device | null; miners: User[]; close: () => void; saved: (key: string | null) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A disabled or reassigned miner still appears as the current value while editing.
  const currentMiner = device?.userId && !miners.some(miner => miner.id === device.userId)
    ? [{ value: device.userId, label: device.minerName ?? 'Minero asignado' }]
    : []

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const data = new FormData(event.currentTarget)
    const body = {
      name: String(data.get('name')),
      zone: String(data.get('zone')),
      userId: String(data.get('userId') ?? '') || null,
      active: data.get('active') === 'on',
    }
    try {
      const result = await (device ? devicesApi.update(device.id, body) : devicesApi.create(body))
      saved(result.apiKey)
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={device ? 'Editar manilla' : 'Registrar manilla'} subtitle="Vincula el dispositivo a un minero y su zona de trabajo." close={close}>
      <ApplicationForm className="dialog-form" onSubmit={submit}>
        <div className="form-grid">
          <TextField label="Nombre de la manilla" name="name" required minLength={2} maxLength={60} defaultValue={device?.name} placeholder="Ej. Manilla 01" />
          <TextField label="Zona de trabajo" name="zone" required minLength={2} maxLength={100} defaultValue={device?.zone} placeholder="Ej. Galería norte" />
        </div>
        <Select
          label="Minero asignado"
          name="userId"
          defaultValue={device?.userId ?? ''}
          options={[{ value: '', label: 'Sin asignar' }, ...miners.map(miner => ({ value: miner.id, label: miner.name })), ...currentMiner]}
        />
        <Checkbox label="Manilla habilitada" name="active" defaultChecked={device?.active ?? true} />
        <p className="form-hint">Cada minero puede tener una manilla activa. Al registrar el dispositivo recibirás su credencial de conexión.</p>
        {error && <div className="form-error" role="alert"><AlertCircle size={16} />{error}</div>}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={close}>Cancelar</button>
          <button className="button primary" disabled={busy}><Save size={16} />{busy ? 'Guardando…' : 'Guardar manilla'}</button>
        </div>
      </ApplicationForm>
    </Modal>
  )
}
