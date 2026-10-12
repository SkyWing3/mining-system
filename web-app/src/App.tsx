import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Activity, ArrowRight, ArrowUpRight, Battery, Bell, Check, CheckCheck, ChevronLeft, ChevronRight, CircleHelp, ClipboardCheck, Clock3, Cpu, Download, Edit3, Eye, HardHat, KeyRound, LayoutDashboard, LogOut, MapPin, Menu, MessageSquare, Plus, Radio, Search, Settings, ShieldCheck, Thermometer, TriangleAlert, Users, Wifi, WifiOff, Wind, X } from 'lucide-react'
import { api, ApiError, date, initials, loadWithRecovery, post, roleName } from './api'
import { Brand, Empty, MessageRows, Modal } from './components'
import { DeviceForm, KeyModal, TelemetryModal, UserForm } from './Forms'
import Login from './Login'
import { useRealtime } from './useRealtime'
import type { AuditEvent, Device, Message, MessageList, Overview, Page, Reading, User } from './types'
import './App.css'

const pageInfo: Record<Page, { title: string; description: string; icon: typeof Activity }> = {
  dashboard: { title: 'Vista general', description: 'La información esencial de tu operación, en un solo lugar.', icon: LayoutDashboard },
  messages: { title: 'Mensajes', description: 'Cada reporte de tu equipo, recibido directamente desde las manillas.', icon: MessageSquare },
  alerts: { title: 'Alertas de seguridad', description: 'Prioriza los reportes críticos y registra su revisión.', icon: TriangleAlert },
  devices: { title: 'Manillas', description: 'Administra dispositivos, asignaciones y lecturas de tu equipo.', icon: Cpu },
  users: { title: 'Usuarios', description: 'Gestiona a tu equipo y sus permisos de acceso.', icon: Users },
  activity: { title: 'Actividad', description: 'Un registro de las acciones realizadas en la central.', icon: ClipboardCheck },
  settings: { title: 'Mi cuenta y sistema', description: 'Tu acceso, la identidad de la central y su funcionamiento.', icon: Settings },
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [setup, setSetup] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => loadWithRecovery(async signal => {
    const status = await api<{ setupRequired: boolean }>('/auth/status', { signal })
    if (status.setupRequired) return { setupRequired: true, user: null }
    try { return { setupRequired: false, user: await api<User>('/auth/me', { signal }) } }
    catch (error) { if (error instanceof ApiError && error.status === 401) return { setupRequired: false, user: null }; throw error }
  }, result => {
    setSetup(result.setupRequired); setUser(result.user); setError(''); setLoading(false)
  }, error => { setError((error as Error).message); setLoading(false) }), [])
  if (loading || error) return <div className="startup"><Brand /><div>{error ? <><WifiOff size={32} /><h1>No pudimos conectar con la central</h1><p role="alert">{error}</p><p role="status">La conexión se restablecerá automáticamente.</p></> : <><span className="spinner" /><p>Conectando con tu central…</p></>}</div></div>
  return user ? <Central user={user} signOut={() => setUser(null)} /> : <Login setup={setup} authenticated={setUser} />
}

function Central({ user, signOut }: { user: User; signOut: () => void }) {
  const [page, setPage] = useState<Page>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [miners, setMiners] = useState<User[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [tick, setTick] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ text: string; critical?: boolean } | null>(null)
  const [userModal, setUserModal] = useState<User | 'new' | null>(null)
  const [deviceModal, setDeviceModal] = useState<Device | 'new' | null>(null)
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [rotateDevice, setRotateDevice] = useState<Device | null>(null)
  const [telemetry, setTelemetry] = useState<{ device: Device; readings: Reading[] } | null>(null)
  const [reviewMessage, setReviewMessage] = useState<Message | null>(null)
  const [busyAction, setBusyAction] = useState(false)
  const [actionError, setActionError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const syncData = useCallback(() => setTick(value => value + 1), [])
  const notify = useCallback((message: Message) => setNotice({ text: `${message.minerName}: ${message.text}`, critical: message.severity === 'critical' }), [])
  const connection = useRealtime(user.id, syncData, notify)
  const handleError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) signOut()
    else setError((error as Error).message)
  }, [signOut])

  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer) }, [])
  useEffect(() => { if (notice && !notice.critical) { const timer = setTimeout(() => setNotice(null), 7000); return () => clearTimeout(timer) } }, [notice])
  useEffect(() => loadWithRecovery(signal => Promise.all([
    api<Overview>('/overview', { signal }), api<Device[]>('/devices', { signal }), api<User[]>('/devices/miners', { signal }),
  ]), ([summary, items, personnel]) => {
    setOverview(summary); setDevices(items); setMiners(personnel); setError(''); setLoading(false)
  }, error => { handleError(error); setLoading(false) }, 120), [tick, handleError])
  useEffect(() => {
    if (page === 'users' && user.role === 'Admin') return loadWithRecovery(signal => api<User[]>('/users', { signal }), setUsers, handleError)
    if (page === 'activity') return loadWithRecovery(signal => api<AuditEvent[]>('/events', { signal }), setEvents, handleError)
  }, [page, tick, user.role, handleError])
  const telemetryDeviceId = telemetry?.device.id
  useEffect(() => {
    if (!telemetryDeviceId) return
    return loadWithRecovery(signal => api<Reading[]>(`/devices/${telemetryDeviceId}/telemetry`, { signal }), readings => {
      setTelemetry(current => current?.device.id === telemetryDeviceId ? { ...current, readings } : current)
    }, handleError)
  }, [tick, telemetryDeviceId, handleError])

  function navigate(next: Page) { setPage(next); setSidebarOpen(false); setError(''); setActionError('') }
  function openReview(message: Message) { setActionError(''); setReviewMessage(message) }
  async function review() {
    if (!reviewMessage) return
    setBusyAction(true); setActionError('')
    try { await post(`/messages/${reviewMessage.id}/review`); setReviewMessage(null); setNotice({ text: 'La revisión quedó registrada.' }); syncData() }
    catch (error) { setActionError((error as Error).message) } finally { setBusyAction(false) }
  }
  async function rotate() {
    if (!rotateDevice) return
    setBusyAction(true); setActionError('')
    try { const result = await post<{ apiKey: string }>(`/devices/${rotateDevice.id}/rotate-key`); setRotateDevice(null); setApiKey(result.apiKey); syncData() }
    catch (error) { setActionError((error as Error).message) } finally { setBusyAction(false) }
  }
  async function inspect(device: Device) {
    try { const readings = await api<Reading[]>(`/devices/${device.id}/telemetry`); setTelemetry({ device, readings }) } catch (error) { handleError(error) }
  }
  async function logout() { try { await post('/auth/logout'); signOut() } catch (error) { handleError(error) } }
  const navigation: Page[] = ['dashboard', 'messages', 'alerts', 'devices', ...(user.role === 'Admin' ? ['users' as Page] : []), 'activity']
  const dateLabel = new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/La_Paz' }).format(now)

  return <div className="app-shell">
    {sidebarOpen && <button className="sidebar-overlay" aria-label="Cerrar navegación" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}><Brand compact /><div className="sidebar-label">CENTRAL DE OPERACIONES</div><nav aria-label="Navegación principal">{navigation.map(key => { const Icon = pageInfo[key].icon; return <button key={key} className={`nav-item ${page === key ? 'active' : ''}`} onClick={() => navigate(key)} aria-current={page === key ? 'page' : undefined}><Icon size={19} strokeWidth={1.7} /><span>{key === 'dashboard' ? 'Vista general' : key === 'alerts' ? 'Alertas' : pageInfo[key].title}</span>{key === 'alerts' && !!overview?.pendingAlerts && <span className="nav-count">{overview.pendingAlerts}</span>}</button> })}</nav><div className="sidebar-bottom"><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings size={19} strokeWidth={1.7} /><span>Mi cuenta y sistema</span></button><div className="sidebar-user"><span className="avatar">{initials(user.name)}</span><div><strong>{user.name}</strong><small>{roleName[user.role]}</small></div><button className="icon-button" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={() => void logout()}><LogOut size={18} /></button></div></div></aside>
    <div className="workspace"><header className="topbar"><div className="topbar-location"><button className="icon-button mobile-menu" aria-label="Abrir navegación" onClick={() => setSidebarOpen(true)}><Menu size={21} /></button><span>Central</span><ChevronRight size={14} /><strong>{pageInfo[page].title}</strong></div><div className="topbar-right"><span className="topbar-date"><Clock3 size={15} />{dateLabel}</span><span className="topbar-divider" /><button className="notification-button" aria-label={`Ver alertas: ${overview?.pendingAlerts ?? 0} pendientes`} onClick={() => navigate('alerts')}><Bell size={19} />{!!overview?.pendingAlerts && <span />}</button><span className="avatar small">{initials(user.name)}</span></div></header>
    <main className="main-content"><div className="page-heading"><div><span className="eyebrow">{page === 'dashboard' ? 'TU OPERACIÓN, CONECTADA' : 'MINING SYSTEM'}</span><h1>{pageInfo[page].title}</h1><p>{pageInfo[page].description}</p></div>{(page === 'users' || page === 'devices') && <div className="page-heading-actions">{page === 'users' ? <button className="button primary" onClick={() => setUserModal('new')}><Plus size={17} />Crear usuario</button> : <button className="button primary" onClick={() => setDeviceModal('new')}><Plus size={17} />Registrar manilla</button>}</div>}</div>
      {connection !== 'online' && <div className="connection-warning" role="status"><WifiOff size={17} />El enlace en vivo se está restableciendo. Los datos visibles pueden estar desactualizados.</div>}
      {error && <div className="error-banner" role="alert"><TriangleAlert size={18} /><span>{error}</span></div>}
      {loading ? <div className="loading-panel"><span className="spinner" />Cargando la operación…</div> : <>
        {page === 'dashboard' && overview && <Dashboard overview={overview} devices={devices} navigate={navigate} review={openReview} inspect={inspect} />}
        {(page === 'messages' || page === 'alerts') && <MessagesPage key={page} alerts={page === 'alerts'} tick={tick} devices={devices} review={openReview} onError={handleError} />}
        {page === 'devices' && <DeviceTable devices={devices} edit={setDeviceModal} rotate={device => { setActionError(''); setRotateDevice(device) }} inspect={inspect} add={() => setDeviceModal('new')} />}
        {page === 'users' && <UsersPage users={users} edit={setUserModal} />}
        {page === 'activity' && <ActivityPage events={events} />}
        {page === 'settings' && <SettingsPage user={user} saved={() => { syncData(); setNotice({ text: 'Contraseña actualizada. Tu acceso está listo.' }) }} />}
      </>}
      <footer className="main-footer"><span>MINING SYSTEM <span className="dot-separator">·</span> Seguridad conectada</span><span>Hora de la central: Bolivia (UTC−4)</span></footer>
    </main></div>
    {notice && <div className={`toast ${notice.critical ? 'critical' : ''}`} role={notice.critical ? 'alert' : 'status'}>{notice.critical ? <TriangleAlert size={20} /> : <CheckCheck size={20} />}<span>{notice.text}</span>{notice.critical && <button className="text-button" onClick={() => { navigate('alerts'); setNotice(null) }}>Ver alerta<ArrowRight size={15} /></button>}<button className="icon-button" aria-label="Cerrar notificación" onClick={() => setNotice(null)}><X size={17} /></button></div>}
    {userModal && <UserForm user={userModal === 'new' ? null : userModal} close={() => setUserModal(null)} saved={syncData} />}
    {deviceModal && <DeviceForm device={deviceModal === 'new' ? null : deviceModal} miners={miners} close={() => setDeviceModal(null)} saved={key => { setDeviceModal(null); setApiKey(key); syncData(); if (!key) setNotice({ text: 'Manilla actualizada.' }) }} />}
    {apiKey && <KeyModal apiKey={apiKey} close={() => setApiKey(null)} />}
    {telemetry && <TelemetryModal device={telemetry.device} readings={telemetry.readings} close={() => setTelemetry(null)} />}
    {rotateDevice && <Modal title="Renovar credencial" subtitle={rotateDevice.name} close={() => setRotateDevice(null)}><div className="confirm-content"><p>La credencial actual dejará de funcionar. Copia la nueva en la configuración de la manilla para volver a conectarla.</p>{actionError && <div className="form-error" role="alert">{actionError}</div>}</div><div className="modal-actions"><button className="button secondary" onClick={() => setRotateDevice(null)}>Cancelar</button><button className="button primary" disabled={busyAction} onClick={() => void rotate()}><KeyRound size={16} />{busyAction ? 'Renovando…' : 'Generar nueva credencial'}</button></div></Modal>}
    {reviewMessage && <Modal title="Registrar revisión" subtitle={`${reviewMessage.text} · ${reviewMessage.minerName}`} close={() => setReviewMessage(null)}><div className="confirm-content"><p>La alerta se marcará como revisada por <strong>{user.name}</strong>. Esta acción registra tu revisión en la central; no envía una respuesta ni confirma que el incidente fue resuelto.</p>{actionError && <div className="form-error" role="alert">{actionError}</div>}</div><div className="modal-actions"><button className="button secondary" onClick={() => setReviewMessage(null)}>Cancelar</button><button className="button primary" disabled={busyAction} onClick={() => void review()}><CheckCheck size={16} />{busyAction ? 'Guardando…' : 'Marcar como revisada'}</button></div></Modal>}
  </div>
}

function Dashboard({ overview, devices, navigate, review, inspect }: { overview: Overview; devices: Device[]; navigate: (page: Page) => void; review: (message: Message) => void; inspect: (device: Device) => void }) {
  const active = devices.filter(device => device.active)
  const online = active.filter(device => device.online)
  const coverage = active.length ? Math.round(online.length / active.length * 100) : 0
  const zones = [...new Set(active.map(device => device.zone))]
  return <>
    <div className="stats-grid"><Stat label="MINEROS REGISTRADOS" value={overview.activeMiners} icon={<HardHat size={21} />} note="Personal con cuenta activa" /><Stat label="MANILLAS CONECTADAS" value={<>{overview.onlineDevices}<small> / {overview.totalDevices}</small></>} icon={<Radio size={21} />} note="Enlace registrado en los últimos 90 s" /><Stat label="MENSAJES DE HOY" value={overview.messagesToday} icon={<MessageSquare size={21} />} note="Recibidos en la jornada local" /><Stat label="ALERTAS PENDIENTES" value={overview.pendingAlerts} icon={<TriangleAlert size={21} />} note={overview.pendingAlerts ? 'Reportes críticos por revisar' : 'Sin reportes críticos pendientes'} alert /></div>
    {overview.pendingAlerts > 0 && <div className="alert-callout"><span className="alert-callout-icon"><TriangleAlert size={22} /></span><div><strong>{overview.pendingAlerts === 1 ? 'Hay un reporte que requiere tu atención' : `${overview.pendingAlerts} reportes requieren tu atención`}</strong><p>Consulta las alertas de tu equipo y registra su revisión.</p></div><button className="text-button" onClick={() => navigate('alerts')}>Ver alertas<ArrowRight size={17} /></button></div>}
    <div className="dashboard-grid"><section className="panel recent-panel"><PanelHeading title="Últimos mensajes" subtitle="Reportes enviados desde el terreno" action={<button className="text-button" onClick={() => navigate('messages')}>Ver todos<ArrowUpRight size={16} /></button>} />{overview.recentMessages.length ? <MessageRows messages={overview.recentMessages.slice(0, 5)} review={review} compact /> : <Empty title="Aquí comienza la comunicación" text="Los reportes de las manillas aparecerán aquí al instante." />}<div className="panel-bottom-note"><ShieldCheck size={15} />Canal de recepción de mensajes del equipo</div></section><section className="panel coverage-panel"><PanelHeading title="Cobertura del equipo" subtitle="Disponibilidad de las manillas activas" /><div className="coverage-ring"><svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="65" fill="none" stroke="var(--chart-grid)" strokeWidth="11" /><circle cx="80" cy="80" r="65" fill="none" stroke="var(--accent-plum)" strokeWidth="11" strokeDasharray={`${coverage / 100 * 408.4} 408.4`} transform="rotate(-90 80 80)" strokeLinecap="round" /></svg><div><strong>{coverage}<small>%</small></strong><span>conectadas</span></div></div><div className="coverage-legend"><span><i className="legend-dot online" />Conectadas<strong>{online.length}</strong></span><span><i className="legend-dot offline" />Sin conexión<strong>{active.length - online.length}</strong></span></div><button className="button secondary coverage-link" onClick={() => navigate('devices')}>Gestionar manillas<ArrowRight size={16} /></button></section></div>
    <div className="dashboard-bottom-grid"><section className="panel"><PanelHeading title="Equipo en el terreno" subtitle="Conexión y últimas mediciones recibidas" action={<button className="text-button" onClick={() => navigate('devices')}>Ver manillas<ArrowUpRight size={16} /></button>} />{active.length ? <div className="team-list">{active.slice(0, 4).map(device => <button className="team-row" key={device.id} onClick={() => inspect(device)}><span className="avatar neutral"><HardHat size={20} strokeWidth={1.6} /></span><span className="team-person"><strong>{device.minerName ?? 'Sin asignar'}</strong><small>{device.name} · {device.zone}</small></span><span className="team-reading"><Thermometer size={15} />{device.reading?.temperatureC == null ? 'Sin lectura' : `${device.reading.temperatureC.toFixed(1)} °C`}</span><DeviceStatus device={device} /><ChevronRight size={16} /></button>)}</div> : <Empty title="Conecta tu primera manilla" text="Registra un dispositivo y asígnalo a un minero para comenzar." action={<button className="button secondary" onClick={() => navigate('devices')}><Plus size={16} />Ir a manillas</button>} />}</section><section className="panel zones-panel"><PanelHeading title="Zonas de trabajo" subtitle="Distribución de manillas registradas" />{zones.length ? <div className="zone-list">{zones.slice(0, 5).map(zone => { const count = active.filter(x => x.zone === zone).length; return <div className="zone-row" key={zone}><div><span><MapPin size={15} />{zone}</span><strong>{count}<small> {count === 1 ? 'manilla' : 'manillas'}</small></strong></div><div className="zone-track"><span style={{ width: `${count / active.length * 100}%` }} /></div></div> })}</div> : <Empty title="Sin zonas registradas" text="Las zonas se definen al registrar cada manilla." />}</section></div>
  </>
}

function Stat({ label, value, icon, note, alert = false }: { label: string; value: ReactNode; icon: ReactNode; note: string; alert?: boolean }) {
  return <article className={`stat-card ${alert ? 'alert' : ''}`}><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><div className="stat-number">{value}</div><p>{alert && <span className="tiny-dot" />}{note}</p></article>
}
function PanelHeading({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) { return <div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</div> }
function DeviceStatus({ device }: { device: Device }) { return <span className={`device-status ${!device.active ? 'disabled' : device.online ? 'online' : 'offline'}`}><span />{!device.active ? 'Deshabilitada' : device.online ? 'Conectada' : 'Sin conexión'}</span> }

function MessagesPage({ alerts, tick, devices, review, onError }: { alerts: boolean; tick: number; devices: Device[]; review: (message: Message) => void; onError: (error: unknown) => void }) {
  const [search, setSearch] = useState('')
  const [severity, setSeverity] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [pending, setPending] = useState(true)
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<MessageList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '25' })
    if (search) params.set('search', search)
    if (alerts || severity) params.set('severity', alerts ? 'critical' : severity)
    if (deviceId) params.set('deviceId', deviceId)
    if (alerts && pending) params.set('pending', 'true')
    return loadWithRecovery(signal => {
      setLoading(true)
      return api<MessageList>(`/messages?${params}`, { signal })
    }, data => { setResult(data); setError(''); setLoading(false) }, error => {
      setError((error as Error).message); setLoading(false); onError(error)
    }, search ? 250 : 100)
  }, [search, severity, deviceId, pending, alerts, page, tick, onError])
  function exportCsv() {
    const rows = [['ID', 'Mensaje', 'Prioridad', 'Minero', 'Manilla', 'Zona', 'Enviado', 'Recibido', 'Revisado por'], ...(result?.items ?? []).map(x => [String(x.id), x.text, x.severity, x.minerName, x.deviceName, x.zone, date(x.sentAt, true), date(x.receivedAt, true), x.reviewedBy ?? ''])]
    const csv = '\uFEFF' + rows.map(row => row.map(cell => `"${(/^[=+\-@]/.test(cell) ? "'" : '') + cell.replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `mining-mensajes-pagina-${page}.csv`; anchor.click(); URL.revokeObjectURL(url)
  }
  return <section className="panel messages-panel"><div className="message-toolbar">{alerts && <div className="tabs"><button className={pending ? 'selected' : ''} onClick={() => { setPending(true); setPage(1) }}>Pendientes</button><button className={!pending ? 'selected' : ''} onClick={() => { setPending(false); setPage(1) }}>Todas las alertas</button></div>}<label className="search-field"><Search size={17} /><input aria-label="Buscar mensajes" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} placeholder="Buscar mensaje, minero o zona…" /></label>{!alerts && <select aria-label="Filtrar prioridad" value={severity} onChange={event => { setSeverity(event.target.value); setPage(1) }}><option value="">Todas las prioridades</option><option value="critical">Críticas</option><option value="warning">Atención</option><option value="info">Informativas</option></select>}<select aria-label="Filtrar manilla" value={deviceId} onChange={event => { setDeviceId(event.target.value); setPage(1) }}><option value="">Todas las manillas</option>{devices.map(device => <option value={device.id} key={device.id}>{device.name}</option>)}</select><button className="button secondary export-button" disabled={!result?.items.length || loading || !!error} onClick={exportCsv}><Download size={16} />Exportar página</button></div><div className="message-inbox-heading"><span>{alerts ? 'REPORTES CRÍTICOS' : 'BANDEJA DE ENTRADA'} <b>{result?.total ?? 0}</b></span><span><Radio size={14} />Recepción desde las manillas</span></div>{error ? <Empty title="No se pudo actualizar la bandeja" text={error} /> : loading && !result ? <div className="loading-panel"><span className="spinner" />Cargando mensajes…</div> : result?.items.length ? <MessageRows messages={result.items} review={review} /> : <Empty title={alerts ? 'Sin alertas en esta vista' : 'Sin mensajes en esta vista'} text={search || deviceId || severity ? 'Prueba otros filtros para encontrar los reportes.' : alerts ? 'Aquí aparecerán los reportes críticos enviados por tu equipo.' : 'Los mensajes predeterminados aparecerán cuando una manilla los envíe.'} />}<div className="pagination"><span>{loading ? 'Actualizando…' : `${result?.total ?? 0} ${alerts ? 'alertas' : 'mensajes'}`}<span className="dot-separator">·</span>Solo recepción</span><div><button className="icon-button" aria-label="Página anterior" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}><ChevronLeft size={18} /></button><span>Página {page} de {Math.max(1, Math.ceil((result?.total ?? 0) / 25))}</span><button className="icon-button" aria-label="Página siguiente" disabled={page * 25 >= (result?.total ?? 0) || loading} onClick={() => setPage(page + 1)}><ChevronRight size={18} /></button></div></div></section>
}

function DeviceTable({ devices, edit, rotate, inspect, add }: { devices: Device[]; edit: (device: Device) => void; rotate: (device: Device) => void; inspect: (device: Device) => void; add: () => void }) {
  const [search, setSearch] = useState('')
  const items = devices.filter(x => `${x.name} ${x.minerName ?? ''} ${x.zone}`.toLowerCase().includes(search.toLowerCase()))
  return <section className="panel"><div className="table-toolbar"><label className="search-field"><Search size={17} /><input aria-label="Buscar manillas" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar manilla, minero o zona…" /></label><span>{devices.length} dispositivos registrados</span></div>{items.length ? <div className="table-scroll"><table><thead><tr><th>MANILLA / MINERO</th><th>ZONA</th><th>CONEXIÓN</th><th>TEMPERATURA</th><th>GAS</th><th>BATERÍA</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{items.map(device => <tr key={device.id}><td><div className="table-person"><span className="table-device-icon"><Cpu size={19} /></span><div><strong>{device.name}</strong><small>{device.minerName ?? 'Sin asignar'}</small></div></div></td><td><span className="zone-cell"><MapPin size={14} />{device.zone}</span></td><td><DeviceStatus device={device} /><small className="last-seen">{date(device.lastSeenAt, true)}</small></td><td><span className="reading-cell"><Thermometer size={15} />{device.reading?.temperatureC == null ? '—' : `${device.reading.temperatureC.toFixed(1)} °C`}</span></td><td><span className="reading-cell"><Wind size={15} />{device.reading?.gasPpm == null ? '—' : `${device.reading.gasPpm.toFixed(0)} ppm`}</span></td><td><span className="reading-cell"><Battery size={16} />{device.reading?.batteryPercent == null ? '—' : `${device.reading.batteryPercent.toFixed(0)} %`}</span></td><td><div className="row-actions"><button className="icon-button" aria-label={`Ver lecturas de ${device.name}`} title="Ver lecturas" onClick={() => inspect(device)}><Eye size={17} /></button><button className="icon-button" aria-label={`Editar ${device.name}`} title="Editar manilla" onClick={() => edit(device)}><Edit3 size={17} /></button><button className="icon-button" aria-label={`Renovar credencial de ${device.name}`} title="Renovar credencial" onClick={() => rotate(device)}><KeyRound size={17} /></button></div></td></tr>)}</tbody></table></div> : <Empty title={search ? 'No encontramos manillas' : 'Tu equipo empieza aquí'} text={search ? 'Prueba con otro nombre o zona.' : 'Registra una manilla y asígnala a un minero para recibir sus reportes.'} action={!search && <button className="button primary" onClick={add}><Plus size={16} />Registrar manilla</button>} />}<div className="panel-bottom-note"><CircleHelp size={15} />Las lecturas muestran el último dato recibido. Una manilla sin señal reciente aparece sin conexión.</div></section>
}

function UsersPage({ users, edit }: { users: User[]; edit: (user: User) => void }) {
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const items = users.filter(x => `${x.name} ${x.email}`.toLowerCase().includes(search.toLowerCase()) && (!role || x.role === role))
  return <section className="panel"><div className="table-toolbar"><label className="search-field"><Search size={17} /><input aria-label="Buscar usuarios" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar nombre o correo…" /></label><select aria-label="Filtrar rol" value={role} onChange={event => setRole(event.target.value)}><option value="">Todos los roles</option><option value="Admin">Administrador</option><option value="Supervisor">Supervisor</option><option value="Miner">Minero</option></select><span>{users.length} usuarios registrados</span></div>{items.length ? <div className="table-scroll"><table><thead><tr><th>USUARIO</th><th>ROL</th><th>ESTADO</th><th>FECHA DE REGISTRO</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{items.map(user => <tr key={user.id}><td><div className="table-person"><span className="avatar neutral">{initials(user.name)}</span><div><strong>{user.name}</strong><small>{user.email}</small></div></div></td><td><span className={`role-badge ${user.role.toLowerCase()}`}>{roleName[user.role]}</span></td><td><span className={`account-status ${user.active ? 'active' : ''}`}><span />{user.active ? 'Activo' : 'Inactivo'}</span></td><td className="muted">{date(user.createdAt, true)}</td><td><button className="button secondary small-button" onClick={() => edit(user)}><Edit3 size={15} />Editar</button></td></tr>)}</tbody></table></div> : <Empty title="Sin usuarios en esta vista" text="Prueba otro nombre o selecciona un rol diferente." />}<div className="panel-bottom-note"><ShieldCheck size={15} />Las cuentas y las asignaciones se conservan al desactivarlas para mantener el historial.</div></section>
}

function ActivityPage({ events }: { events: AuditEvent[] }) {
  return <section className="panel"><PanelHeading title="Registro de la central" subtitle="Las 100 acciones más recientes, con su autor y fecha" />{events.length ? <div className="activity-list">{events.map(event => <article className="activity-row" key={event.id}><span className="activity-icon"><Activity size={17} /></span><div><strong>{event.actor}</strong><p>{event.description}</p></div><time>{date(event.createdAt, true)}</time></article>)}</div> : <Empty title="Sin actividad registrada" text="Las acciones de administración aparecerán aquí." />}</section>
}

function SettingsPage({ user, saved }: { user: User; saved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSuccess(false)
    const form = event.currentTarget
    const data = new FormData(form)
    if (data.get('newPassword') !== data.get('confirm')) { setError('Las contraseñas nuevas no coinciden.'); return }
    setBusy(true)
    try { await post('/auth/password', { currentPassword: data.get('currentPassword'), newPassword: data.get('newPassword') }); form.reset(); setSuccess(true); saved() }
    catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  return <div className="settings-grid"><section className="panel"><PanelHeading title="Tu cuenta" subtitle="Información de acceso y seguridad" /><div className="account-summary"><span className="avatar large">{initials(user.name)}</span><div><strong>{user.name}</strong><p>{user.email}</p><span className="role-badge">{roleName[user.role]}</span></div></div><form className="password-form" onSubmit={submit}><h3>Cambiar contraseña</h3><label>Contraseña actual<input name="currentPassword" type="password" required autoComplete="current-password" /></label><label>Nueva contraseña<input name="newPassword" type="password" required minLength={10} maxLength={128} autoComplete="new-password" placeholder="Al menos 10 caracteres" /></label><label>Confirmar nueva contraseña<input name="confirm" type="password" required minLength={10} maxLength={128} autoComplete="new-password" /></label>{error && <div className="form-error" role="alert">{error}</div>}{success && <div className="success-note" role="status"><Check size={16} />Contraseña actualizada</div>}<button className="button primary" disabled={busy}><KeyRound size={16} />{busy ? 'Guardando…' : 'Actualizar contraseña'}</button></form></section><div><section className="panel"><PanelHeading title="Identidad del sistema" subtitle="Una marca pensada para una operación clara" /><div className="brand-settings"><Brand /><div className="palette" aria-label="Paleta de marca"><span style={{ background: '#dec1af' }} /><span style={{ background: '#491a06' }} /><span style={{ background: '#373946' }} /><span style={{ background: '#852a3b' }} /><span style={{ background: '#6c4b68' }} /></div><p>Arena, tierra, carbón, vino y ciruela.<br />Una interfaz clara con blanco como base.</p></div></section><section className="panel system-settings"><PanelHeading title="Funcionamiento de la central" subtitle="Conectividad y comunicación del equipo" /><div className="system-detail"><Radio size={19} /><div><strong>Reportes del equipo</strong><p>Los reportes llegan desde el menú OLED de las manillas.</p></div></div><div className="system-detail"><MessageSquare size={19} /><div><strong>Canal de recepción</strong><p>La central visualiza reportes y registra revisiones internas.</p></div></div><div className="system-detail"><Clock3 size={19} /><div><strong>Hora de Bolivia · UTC−4</strong><p>Fechas visibles en horario local; historial almacenado en UTC.</p></div></div><div className="system-detail"><Wifi size={19} /><div><strong>Estado de conexión</strong><p>Una manilla se considera conectada si reportó en los últimos 90 segundos.</p></div></div></section></div></div>
}
