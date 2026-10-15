import { useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Clock3, KeyRound, Megaphone, MessageSquare, Radio, Wifi } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { authApi } from '../api/endpoints'
import { Brand } from '../components/ui/Brand'
import { PanelHeading } from '../components/ui/Feedback'
import { ApplicationForm, TextField } from '../components/ui/controls'
import type { User } from '../types/domain'
import { initials, roleName } from '../utils/format'

const palette = ['#dec1af', '#491a06', '#373946', '#852a3b', '#6c4b68']

export function SettingsPage({ user, saved }: { user: User; saved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess(false)
    const form = event.currentTarget
    const data = new FormData(form)
    if (data.get('newPassword') !== data.get('confirm')) {
      setError('Las contraseñas nuevas no coinciden.')
      return
    }
    setBusy(true)
    try {
      await authApi.changePassword({ currentPassword: String(data.get('currentPassword')), newPassword: String(data.get('newPassword')) })
      form.reset()
      setSuccess(true)
      saved()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-grid">
      <section className="panel">
        <PanelHeading title="Tu cuenta" subtitle="Información de acceso y seguridad" />
        <div className="account-summary">
          <span className="avatar large">{initials(user.name)}</span>
          <div><strong>{user.name}</strong><p>{user.email}</p><span className="role-badge">{roleName[user.role]}</span></div>
        </div>
        <ApplicationForm className="password-form" onSubmit={submit}>
          <h3>Cambiar contraseña</h3>
          <TextField label="Contraseña actual" name="currentPassword" type="password" required />
          <TextField label="Nueva contraseña" name="newPassword" type="password" required minLength={10} maxLength={128} placeholder="Al menos 10 caracteres" />
          <TextField label="Confirmar nueva contraseña" name="confirm" type="password" required minLength={10} maxLength={128} />
          {error && <div className="form-error" role="alert">{error}</div>}
          {success && <div className="success-note" role="status"><Check size={16} />Contraseña actualizada</div>}
          <button className="button primary" disabled={busy}><KeyRound size={16} />{busy ? 'Guardando…' : 'Actualizar contraseña'}</button>
        </ApplicationForm>
      </section>
      <div>
        <section className="panel">
          <PanelHeading title="Identidad del sistema" subtitle="Una marca pensada para una operación clara" />
          <div className="brand-settings">
            <Brand />
            <div className="palette" aria-label="Paleta de marca">{palette.map(color => <span key={color} style={{ background: color }} />)}</div>
            <p>Arena, tierra, carbón, vino y ciruela.<br />Una interfaz clara con blanco como base.</p>
          </div>
        </section>
        <section className="panel system-settings">
          <PanelHeading title="Funcionamiento de la central" subtitle="Conectividad y comunicación del equipo" />
          <SystemDetail icon={Radio} title="Lecturas en tiempo real" text="Cada manilla envía sus sensores por WebSocket cada pocos segundos; la central los muestra al instante." />
          <SystemDetail icon={MessageSquare} title="Reportes y voz" text="Los reportes del menú OLED y los mensajes de voz llegan con identidad, zona y hora." />
          <SystemDetail icon={Megaphone} title="Avisos a manillas" text="Los avisos se entregan por el mismo enlace y la manilla confirma su lectura." />
          <SystemDetail icon={Clock3} title="Hora de Bolivia · UTC−4" text="Fechas visibles en horario local; historial almacenado en UTC." />
          <SystemDetail icon={Wifi} title="Estado de conexión" text="Una manilla se considera conectada si reportó en los últimos 90 segundos." />
        </section>
      </div>
    </div>
  )
}

function SystemDetail({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return <div className="system-detail"><Icon size={19} /><div><strong>{title}</strong><p>{text}</p></div></div>
}
