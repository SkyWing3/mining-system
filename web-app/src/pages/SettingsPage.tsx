import { useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Clock3, KeyRound, Megaphone, MessageSquare, Radio, Wifi } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { authApi } from '../api/endpoints'
import { Brand } from '../components/ui/Brand'
import { Chip, PanelHeading } from '../components/ui/Feedback'
import { ApplicationForm, TextField } from '../components/ui/controls'
import type { User } from '../types/domain'
import { initials, roleName } from '../utils/format'

// Swatches read the design tokens (styles/index.css), so this page always shows the colors in use.
const palette = [
  { name: 'Arena', token: '--sand' },
  { name: 'Tierra', token: '--earth' },
  { name: 'Carbón', token: '--charcoal' },
  { name: 'Vino', token: '--wine' },
  { name: 'Ciruela', token: '--plum' },
]
// The states reuse the brand: no color outside the palette.
const states = [
  { name: 'Peligro · Vino', token: '--wine' },
  { name: 'Precaución · Arena', token: '--sand' },
  { name: 'Normal · Carbón', token: '--charcoal' },
]

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
          <span className="avatar large" aria-hidden="true">{initials(user.name)}</span>
          <div><strong>{user.name}</strong><p>{user.email}</p><Chip tone="outline" className="role-badge">{roleName[user.role]}</Chip></div>
        </div>
        <ApplicationForm className="password-form" onSubmit={submit}>
          <h3>Cambiar contraseña</h3>
          <TextField label="Contraseña actual" name="currentPassword" type="password" autoComplete="current-password" required />
          <TextField label="Nueva contraseña" name="newPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={128} placeholder="Al menos 10 caracteres" />
          <TextField label="Confirmar nueva contraseña" name="confirm" type="password" autoComplete="new-password" required minLength={10} maxLength={128} />
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
            <Swatches label="Paleta de marca" colors={palette} />
            <Swatches label="Colores de los estados" colors={states} />
            <p>Arena, tierra, carbón, vino y ciruela identifican la central y también marcan sus estados: vino para peligro, arena con texto tierra para precaución y carbón para normal. Cada estado va siempre con su nombre o su icono.</p>
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
  return <div className="system-detail"><Icon size={18} aria-hidden="true" /><div><strong>{title}</strong><p>{text}</p></div></div>
}

function Swatches({ label, colors }: { label: string; colors: { name: string; token: string }[] }) {
  const [values] = useState(() => {
    const root = getComputedStyle(document.documentElement)
    return colors.map(item => root.getPropertyValue(item.token).trim().toUpperCase())
  })
  return (
    <div className="palette-group">
      <span className="palette-label">{label}</span>
      <ul className="palette" aria-label={label}>
        {colors.map((item, index) => (
          <li key={item.token}>
            <span style={{ background: `var(${item.token})` }} aria-hidden="true" />
            <small>{item.name}</small>
            <code>{values[index]}</code>
          </li>
        ))}
      </ul>
    </div>
  )
}
