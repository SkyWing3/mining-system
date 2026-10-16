import { useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, Save } from 'lucide-react'
import { usersApi } from '../api/endpoints'
import { ApplicationForm, Checkbox, Select, TextField } from '../components/ui/controls'
import { Modal } from '../components/ui/Modal'
import type { User } from '../types/domain'

export function UserForm({ user, close, saved }: { user: User | null; close: () => void; saved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const data = new FormData(event.currentTarget)
    const body = {
      name: String(data.get('name')),
      email: String(data.get('email')),
      role: String(data.get('role')),
      active: data.get('active') === 'on',
      password: String(data.get('password') ?? '') || null,
    }
    try {
      await (user ? usersApi.update(user.id, body) : usersApi.create(body))
      saved()
      close()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={user ? 'Editar usuario' : 'Crear usuario'} subtitle="Define su acceso y su función en la central." close={close}>
      <ApplicationForm className="dialog-form" onSubmit={submit}>
        <TextField label="Nombre completo" name="name" required minLength={2} maxLength={100} defaultValue={user?.name} placeholder="Nombre y apellido" />
        <TextField label="Correo electrónico" name="email" type="email" required maxLength={180} defaultValue={user?.email} placeholder="nombre@empresa.com" />
        <div className="form-grid">
          <Select
            label="Rol"
            name="role"
            defaultValue={user?.role ?? 'Miner'}
            options={[{ value: 'Miner', label: 'Minero' }, { value: 'Supervisor', label: 'Supervisor' }, { value: 'Admin', label: 'Administrador' }]}
          />
          <TextField
            label="Contraseña"
            hint={user ? 'Opcional; renueva el acceso' : undefined}
            name="password"
            type="password"
            required={!user}
            minLength={10}
            maxLength={128}
            placeholder={user ? 'Conservar la actual' : 'Mínimo 10 caracteres'}
          />
        </div>
        <Checkbox label="Cuenta activa" name="active" defaultChecked={user?.active ?? true} />
        <p className="form-hint">El administrador gestiona usuarios. El supervisor monitorea y administra manillas. El minero envía mensajes desde su manilla.</p>
        {error && <div className="form-error" role="alert"><AlertCircle size={16} />{error}</div>}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={close}>Cancelar</button>
          <button className="button primary" disabled={busy}><Save size={16} />{busy ? 'Guardando…' : 'Guardar usuario'}</button>
        </div>
      </ApplicationForm>
    </Modal>
  )
}
