import { useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, ArrowRight, Check, LockKeyhole, Radio, ShieldCheck } from 'lucide-react'
import { authApi } from '../api/endpoints'
import { Brand } from '../components/ui/Brand'
import { ApplicationForm, TextField } from '../components/ui/controls'
import type { User } from '../types/domain'

export default function LoginPage({ setup, authenticated }: { setup: boolean; authenticated: (user: User) => void }) {
  const [year] = useState(() => new Date().getFullYear())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email'))
    const password = String(data.get('password'))
    try {
      authenticated(setup ? await authApi.setup({ name: String(data.get('name')), email, password }) : await authApi.login({ email, password }))
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-layout">
      <section className="login-story">
        <Brand />
        <div className="login-story-content">
          <span className="eyebrow">TECNOLOGÍA PARA CUIDAR VIDAS</span>
          <h1>Cada conexión.<br />Una vida protegida.</h1>
          <p>La información de tu equipo, en el momento en que más importa. Una central para acompañar cada jornada bajo tierra.</p>
          <MineArt />
          <div className="login-features">
            <span><Radio size={17} /> Mensajes del equipo</span>
            <span><ShieldCheck size={17} /> Acceso por roles</span>
            <span><Check size={17} /> Historial centralizado</span>
          </div>
        </div>
        <footer>MINING SYSTEM <span>Conectados en cada jornada.</span></footer>
      </section>
      <section className="login-form-side">
        <span className="login-top-label"><LockKeyhole size={15} /> CENTRAL DE OPERACIONES</span>
        <div className="login-form-wrap">
          <span className="login-form-icon"><ShieldCheck size={26} strokeWidth={1.5} /></span>
          <h2>{setup ? 'Prepara tu central' : 'Bienvenido de nuevo'}</h2>
          <p>{setup ? 'Crea la primera cuenta de administración para comenzar.' : 'Ingresa tus credenciales para acceder al sistema.'}</p>
          <ApplicationForm onSubmit={submit}>
            {setup && <TextField label="Nombre completo" name="name" required minLength={2} maxLength={100} placeholder="Tu nombre y apellido" />}
            <TextField label="Correo electrónico" name="email" type="email" required maxLength={180} placeholder="nombre@empresa.com" />
            <TextField
              label="Contraseña"
              name="password"
              type="password"
              minLength={setup ? 10 : undefined}
              maxLength={128}
              required
              placeholder={setup ? 'Al menos 10 caracteres' : 'Ingresa tu contraseña'}
            />
            {error && <div className="form-error" role="alert"><AlertCircle size={17} />{error}</div>}
            <button className="button primary login-submit" disabled={busy}>
              {busy ? 'Conectando…' : setup ? 'Crear cuenta y comenzar' : 'Ingresar a la central'}
              <ArrowRight size={18} />
            </button>
          </ApplicationForm>
          <div className="login-access-note">
            <LockKeyhole size={14} />
            <p>
              Acceso exclusivo para personal autorizado.<br />
              {setup ? 'Después podrás registrar supervisores y mineros.' : 'Solicita tu cuenta al administrador de tu central.'}
            </p>
          </div>
        </div>
        <footer>Plataforma de monitoreo y seguridad minera <span>© {year}</span></footer>
      </section>
    </main>
  )
}

function MineArt() {
  return (
    <div className="mine-art" aria-hidden="true">
      <svg viewBox="0 0 520 210" fill="none">
        <path d="M0 186 109 57 194 140 294 16 450 186H0Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="m109 57 10 64 30 17 45 2M294 16l-7 93 37-23 25 41 25 59M194 140l-24 46M294 16l-69 170M119 121l-45 65" stroke="currentColor" strokeWidth="1.5" />
        <path d="M0 204h510M250 204v-38a22 22 0 0 1 44 0v38m-35 0v-35a13 13 0 0 1 26 0v35" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="272" cy="167" r="3" fill="currentColor" />
      </svg>
      <span>VISIBILIDAD SOBRE EL TERRENO</span>
    </div>
  )
}
