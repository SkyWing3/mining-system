import { useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, Check, Copy, KeyRound, Save } from 'lucide-react'
import { post, put } from './api'
import { Modal } from './components'
import { ApplicationForm, Checkbox, Select, TextField } from './controls'
import type { Device, User, Reading } from './types'

export function UserForm({ user, close, saved }: { user: User | null; close: () => void; saved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    const data = new FormData(event.currentTarget)
    const body = { name: data.get('name'), email: data.get('email'), role: data.get('role'), active: data.get('active') === 'on', password: data.get('password') || null }
    try { await (user ? put(`/users/${user.id}`, body) : post('/users', body)); saved(); close() }
    catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  return <Modal title={user ? 'Editar usuario' : 'Crear usuario'} subtitle="Define su acceso y su función en la central." close={close}>
    <ApplicationForm className="dialog-form" onSubmit={submit}>
      <TextField label="Nombre completo" name="name" required minLength={2} maxLength={100} defaultValue={user?.name} placeholder="Nombre y apellido" />
      <TextField label="Correo electrónico" name="email" type="email" required maxLength={180} defaultValue={user?.email} placeholder="nombre@empresa.com" />
      <div className="form-grid">
        <Select label="Rol" name="role" defaultValue={user?.role ?? 'Miner'} options={[
          { value: 'Miner', label: 'Minero' }, { value: 'Supervisor', label: 'Supervisor' }, { value: 'Admin', label: 'Administrador' },
        ]} />
        <TextField label="Contraseña" hint={user ? 'Opcional; renueva el acceso' : undefined} name="password" type="password" required={!user} minLength={10} maxLength={128} placeholder={user ? 'Conservar la actual' : 'Mínimo 10 caracteres'} />
      </div>
      <Checkbox label="Cuenta activa" name="active" defaultChecked={user?.active ?? true} />
      <p className="form-hint">El administrador gestiona usuarios. El supervisor monitorea y administra manillas. El minero envía mensajes desde su manilla.</p>
      {error && <div className="form-error" role="alert"><AlertCircle size={16} />{error}</div>}
      <div className="modal-actions"><button className="button secondary" type="button" onClick={close}>Cancelar</button><button className="button primary" disabled={busy}><Save size={16} />{busy ? 'Guardando…' : 'Guardar usuario'}</button></div>
    </ApplicationForm>
  </Modal>
}

export function DeviceForm({ device, miners, close, saved }: { device: Device | null; miners: User[]; close: () => void; saved: (key: string | null) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    const data = new FormData(event.currentTarget)
    const body = { name: data.get('name'), zone: data.get('zone'), userId: data.get('userId') || null, active: data.get('active') === 'on' }
    try { const result = await (device ? put<{ apiKey: string | null }>(`/devices/${device.id}`, body) : post<{ apiKey: string | null }>('/devices', body)); saved(result.apiKey) }
    catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  return <Modal title={device ? 'Editar manilla' : 'Registrar manilla'} subtitle="Vincula el dispositivo a un minero y su zona de trabajo." close={close}>
    <ApplicationForm className="dialog-form" onSubmit={submit}>
      <div className="form-grid"><TextField label="Nombre de la manilla" name="name" required minLength={2} maxLength={60} defaultValue={device?.name} placeholder="Ej. Manilla 01" /><TextField label="Zona de trabajo" name="zone" required minLength={2} maxLength={100} defaultValue={device?.zone} placeholder="Ej. Galería norte" /></div>
      <Select label="Minero asignado" name="userId" defaultValue={device?.userId ?? ''} options={[
        { value: '', label: 'Sin asignar' }, ...miners.map(miner => ({ value: miner.id, label: miner.name })),
        ...(device?.userId && !miners.some(miner => miner.id === device.userId) ? [{ value: device.userId, label: device.minerName ?? 'Minero asignado' }] : []),
      ]} />
      <Checkbox label="Manilla habilitada" name="active" defaultChecked={device?.active ?? true} />
      <p className="form-hint">Cada minero puede tener una manilla activa. Al registrar el dispositivo recibirás su credencial de conexión.</p>
      {error && <div className="form-error" role="alert"><AlertCircle size={16} />{error}</div>}
      <div className="modal-actions"><button className="button secondary" type="button" onClick={close}>Cancelar</button><button className="button primary" disabled={busy}><Save size={16} />{busy ? 'Guardando…' : 'Guardar manilla'}</button></div>
    </ApplicationForm>
  </Modal>
}

export function KeyModal({ apiKey, close }: { apiKey: string; close: () => void }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  async function copy() { try { await navigator.clipboard.writeText(apiKey); setCopied(true) } catch { setError('Selecciona y copia la credencial manualmente.') } }
  return <Modal title="Credencial de la manilla" subtitle="Se muestra una sola vez. Guárdala en la configuración del dispositivo." close={close}><div className="key-content"><span className="key-icon"><KeyRound size={25} /></span><p>Coloca esta credencial en <code>connection.api_key</code> dentro de <code>device/config/settings.json</code>.</p><pre className="api-key" tabIndex={0}>{apiKey}</pre><button className="button secondary" onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copiada' : 'Copiar credencial'}</button>{error && <p role="alert">{error}</p>}<p className="form-hint">Si la pierdes, puedes generar una nueva desde la lista de manillas. La anterior dejará de funcionar.</p></div><div className="modal-actions"><button className="button primary" onClick={close}>Ya la guardé</button></div></Modal>
}

export function TelemetryModal({ device, readings, close }: { device: Device; readings: Reading[]; close: () => void }) {
  const [metric, setMetric] = useState<'temperatureC' | 'gasPpm' | 'batteryPercent'>('temperatureC')
  const units = { temperatureC: '°C', gasPpm: 'ppm', batteryPercent: '%' }
  const ordered = readings.toReversed()
  const values = ordered.map(x => x[metric]).filter((x): x is number => x !== null)
  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values) : 1
  const y = (value: number) => 155 - ((value - min) / (max - min || 1)) * 120
  const x = (index: number) => 42 + (index / Math.max(1, ordered.length - 1)) * 410
  const segments: string[] = []
  let segment = ''
  ordered.forEach((reading, index) => { const value = reading[metric]; if (value === null) { if (segment) segments.push(segment); segment = '' } else segment += `${x(index)},${y(value)} ` })
  if (segment) segments.push(segment)
  return <Modal title={`Lecturas · ${device.name}`} subtitle={`${device.minerName ?? 'Sin asignar'} · ${device.zone}`} close={close}><div className="telemetry-content"><div className="tabs">{([['temperatureC', 'Temperatura'], ['gasPpm', 'Gas'], ['batteryPercent', 'Batería']] as const).map(([key, label]) => <button key={key} className={metric === key ? 'selected' : ''} onClick={() => setMetric(key)}>{label}</button>)}</div>{values.length ? <><div className="chart-label"><strong>{values.at(-1)?.toFixed(1)} <small>{units[metric]}</small></strong><span>Últimas {readings.length} lecturas recibidas</span></div><svg className="telemetry-chart" viewBox="0 0 480 190" role="img" aria-label={`Historial de ${metric}, mínimo ${min}, máximo ${max} ${units[metric]}`}><path d="M42 25V155H455M42 90H455M42 25H455" stroke="var(--chart-grid)" fill="none" /><text x="4" y="32">{max.toFixed(0)}</text><text x="4" y="156">{min.toFixed(0)}</text>{segments.map((points, index) => <polyline key={index} points={points} stroke="#852a3b" strokeWidth="2" fill="none" />)}{ordered.map((reading, index) => reading[metric] !== null && <circle key={index} cx={x(index)} cy={y(reading[metric])} r="2.5" fill="#852a3b" />)}<text x="42" y="179">Anterior</text><text x="406" y="179">Reciente</text></svg></> : <div className="empty"><h3>Sin lecturas de este sensor</h3><p>Las mediciones aparecerán cuando la manilla las envíe.</p></div>}<p className="form-hint">El gas en ppm requiere un sensor calibrado. Las lecturas recibidas se muestran sin clasificación automática de riesgo.</p></div></Modal>
}
