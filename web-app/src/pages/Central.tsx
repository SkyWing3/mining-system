import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCheck, KeyRound, Megaphone, Plus, TriangleAlert, WifiOff } from 'lucide-react'
import { ApiError } from '../api/client'
import { authApi, devicesApi, monitoringApi } from '../api/endpoints'
import { NoticeForm } from '../components/notices/NoticeForm'
import { TelemetryModal } from '../components/telemetry/TelemetryModal'
import { Spinner } from '../components/ui/Feedback'
import { ConfirmModal } from '../components/ui/Modal'
import { DeviceForm } from '../forms/DeviceForm'
import { KeyModal } from '../forms/KeyModal'
import { UserForm } from '../forms/UserForm'
import { useCentralData, useVersions } from '../hooks/useCentralData'
import type { Scope } from '../hooks/useCentralData'
import { DangerBand } from '../layout/DangerBand'
import { pageInfo } from '../layout/pages'
import { Sidebar } from '../layout/Sidebar'
import { Toast, Topbar } from '../layout/Topbar'
import { LinkContext, presenceKnown } from '../realtime/LinkContext'
import { useLiveTelemetry } from '../realtime/liveTelemetry'
import { useRealtime } from '../realtime/useRealtime'
import type { RealtimeHandlers } from '../realtime/useRealtime'
import type { ChangeCategory, Device, Message, Page, User } from '../types/domain'
import { ActivityPage } from './ActivityPage'
import { DashboardPage } from './DashboardPage'
import { DevicesPage } from './DevicesPage'
import { LivePage } from './LivePage'
import { MessagesPage } from './MessagesPage'
import { NoticesPage } from './NoticesPage'
import { SettingsPage } from './SettingsPage'
import { UsersPage } from './UsersPage'
import { VoicePage } from './VoicePage'

type Dialog =
  | { kind: 'user'; user: User | null }
  | { kind: 'device'; device: Device | null }
  | { kind: 'key'; apiKey: string }
  | { kind: 'rotate'; device: Device }
  | { kind: 'telemetry'; deviceId: string }
  | { kind: 'review'; message: Message }
  | { kind: 'notice'; deviceId?: string }

interface ToastState {
  text: string
  critical: boolean
  target?: { page: Page; label: string }
}

// What each server-side change invalidates.
const changeScopes: Record<ChangeCategory, Scope[]> = {
  users: ['users', 'devices', 'summary', 'activity'],
  devices: ['devices', 'summary', 'activity'],
  presence: ['devices', 'summary'],
  messages: ['messages', 'summary', 'activity'],
  voice: ['voice', 'summary', 'activity'],
  notices: ['notices', 'summary', 'activity'],
}

export function Central({ user, signOut }: { user: User; signOut: () => void }) {
  const [page, setPage] = useState<Page>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [versions, bump] = useVersions()
  const [resync, setResync] = useState(0)
  const [error, setError] = useState('')
  // Critical notices stay until closed and are never replaced by an informative one.
  const [alerts, setAlerts] = useState<ToastState[]>([])
  const [notice, setNotice] = useState<ToastState | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const live = useLiveTelemetry()

  const handleError = useCallback((failure: unknown) => {
    if (failure instanceof ApiError && failure.status === 401) signOut()
    else setError((failure as Error).message)
  }, [signOut])
  const clearError = useCallback(() => setError(''), [])
  const showToast = useCallback((next: ToastState) => {
    if (next.critical) setAlerts(current => [next, ...current.filter(item => item.text !== next.text)].slice(0, 10))
    else setNotice(next)
  }, [])
  const { overview, devices, miners, loading, applyTelemetry, applyMessage } = useCentralData(versions, handleError, clearError)

  const { append } = live
  const handlers = useMemo<RealtimeHandlers>(() => ({
    messageReceived: message => {
      applyMessage(message)
      showToast({
        text: `${message.minerName}: ${message.text}${message.detail ? ` (${message.detail})` : ''}`,
        critical: message.severity === 'critical',
        target: message.severity === 'critical' ? { page: 'alerts', label: 'Ver alerta' } : undefined,
      })
      bump('summary', 'messages', 'activity')
    },
    messageReviewed: () => bump('summary', 'messages', 'activity'),
    telemetryReceived: event => {
      applyTelemetry(event)
      append(event.deviceId, event.reading)
    },
    voiceMessageReceived: voice => {
      showToast({ text: `${voice.minerName} envió un mensaje de voz.`, critical: false, target: { page: 'voice', label: 'Escuchar' } })
      bump('summary', 'voice')
    },
    voiceMessageReviewed: () => bump('summary', 'voice', 'activity'),
    noticeUpdated: () => bump('notices', 'summary'),
    systemChanged: category => bump(...(changeScopes[category] ?? [])),
    resynchronize: () => {
      bump()
      setResync(value => value + 1)
    },
  }), [applyMessage, applyTelemetry, append, bump, showToast])
  const connection = useRealtime(user.id, handlers)

  const navigate = useCallback((next: Page) => {
    setPage(next)
    setSidebarOpen(false)
    setError('')
    setActionError('')
  }, [])
  const closeDialog = useCallback(() => setDialog(null), [])
  const closeAlerts = useCallback(() => setAlerts([]), [])
  const closeNotice = useCallback(() => setNotice(null), [])
  // After moving to another page, focus its heading so keyboard and screen-reader users land on the new content.
  const heading = useRef<HTMLHeadingElement>(null)
  const firstPage = useRef(true)
  useEffect(() => {
    if (firstPage.current) {
      firstPage.current = false
      return
    }
    heading.current?.focus()
  }, [page])
  // Stable callbacks, so a live reading re-renders only the rows and cards of the manilla that sent it.
  const open = useCallback((next: Dialog) => {
    setActionError('')
    setDialog(next)
  }, [])
  const inspect = useCallback((device: Device) => open({ kind: 'telemetry', deviceId: device.id }), [open])
  const reviewMessage = useCallback((message: Message) => open({ kind: 'review', message }), [open])
  const deviceActions = useMemo(() => ({
    edit: (device: Device) => open({ kind: 'device', device }),
    rotate: (device: Device) => open({ kind: 'rotate', device }),
    notify: (device: Device) => open({ kind: 'notice', deviceId: device.id }),
    add: () => open({ kind: 'device', device: null }),
  }), [open])
  const openNavigation = useCallback(() => setSidebarOpen(true), [])
  const showAlerts = useCallback(() => navigate('alerts'), [navigate])

  async function runAction(action: () => Promise<void>) {
    setBusy(true)
    setActionError('')
    try {
      await action()
    } catch (failure) {
      setActionError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const review = (message: Message) => runAction(async () => {
    await monitoringApi.review(message.id)
    setDialog(null)
    showToast({ text: 'La revisión quedó registrada.', critical: false })
    bump('summary', 'messages')
  })

  const rotate = (device: Device) => runAction(async () => {
    const result = await devicesApi.rotateKey(device.id)
    setDialog({ kind: 'key', apiKey: result.apiKey })
    bump('devices')
  })

  const logout = useCallback(() => {
    authApi.logout().then(signOut, handleError)
  }, [signOut, handleError])

  const activeDevices = devices.filter(device => device.active)
  const onlineDevices = activeDevices.filter(device => device.online)
  const dangerNow = onlineDevices.filter(device => device.reading?.level === 'danger')
  // Reported danger and then went silent: the worst case, so it keeps the alarm instead of fading out.
  const dangerLost = activeDevices.filter(device => !device.online && device.reading?.level === 'danger')
  const liveDanger = dangerNow.length
  const telemetryDevice = dialog?.kind === 'telemetry' ? devices.find(device => device.id === dialog.deviceId) : undefined
  const pendingAlerts = overview?.pendingAlerts
  const pendingVoice = overview?.pendingVoice
  const counts = useMemo(() => ({ alerts: pendingAlerts, voice: pendingVoice, live: liveDanger }), [pendingAlerts, pendingVoice, liveDanger])
  const headingAction = {
    users: <button className="button primary" onClick={() => open({ kind: 'user', user: null })}><Plus size={17} />Crear usuario</button>,
    devices: <button className="button primary" onClick={() => open({ kind: 'device', device: null })}><Plus size={17} />Registrar manilla</button>,
    notices: <button className="button primary" onClick={() => open({ kind: 'notice' })}><Megaphone size={17} />Enviar aviso</button>,
  }[page as 'users' | 'devices' | 'notices']

  return (
    <LinkContext.Provider value={connection}>
    <div className="app-shell">
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      {sidebarOpen && <button className="sidebar-overlay" aria-label="Cerrar navegación" onClick={() => setSidebarOpen(false)} />}
      <Sidebar
        user={user}
        page={page}
        open={sidebarOpen}
        counts={counts}
        navigate={navigate}
        logout={logout}
      />
      <div className="workspace">
        <Topbar
          user={user}
          connection={connection}
          loaded={!loading}
          online={onlineDevices.length}
          active={activeDevices.length}
          liveDanger={liveDanger}
          pendingAlerts={pendingAlerts ?? 0}
          openNavigation={openNavigation}
          showAlerts={showAlerts}
        />
        <DangerBand current={dangerNow} lost={dangerLost} series={live.series} visible={page !== 'dashboard'} inspect={inspect} navigate={navigate} />
        <main className="main-content" id="contenido" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <h1 ref={heading} tabIndex={-1}>{pageInfo[page].title}</h1>
              <p>{pageInfo[page].description}</p>
            </div>
            {headingAction && <div className="page-heading-actions">{headingAction}</div>}
          </div>
          {!presenceKnown(connection) && (
            <div className="connection-warning" role="status">
              <WifiOff size={17} aria-hidden="true" /><span>El enlace en vivo se está restableciendo. Los datos visibles pueden estar desactualizados y el estado de cada manilla es desconocido.</span>
            </div>
          )}
          {error && <div className="error-banner" role="alert"><TriangleAlert size={18} aria-hidden="true" /><span>{error}</span></div>}
          {loading || !overview ? <Spinner label="Cargando la operación…" /> : (
            <>
              {page === 'dashboard' && (
                <DashboardPage
                  overview={overview}
                  devices={devices}
                  dangerNow={dangerNow}
                  dangerLost={dangerLost}
                  navigate={navigate}
                  review={reviewMessage}
                  inspect={inspect}
                />
              )}
              {page === 'live' && (
                <LivePage devices={devices} series={live.series} seed={live.seed} resync={resync} inspect={inspect} navigate={navigate} onError={handleError} />
              )}
              {(page === 'messages' || page === 'alerts') && (
                <MessagesPage
                  key={page}
                  alerts={page === 'alerts'}
                  version={versions.messages}
                  devices={devices}
                  review={reviewMessage}
                  onError={handleError}
                />
              )}
              {page === 'voice' && <VoicePage version={versions.voice} devices={devices} onError={handleError} />}
              {page === 'notices' && <NoticesPage version={versions.notices} compose={() => open({ kind: 'notice' })} onError={handleError} />}
              {page === 'devices' && (
                <DevicesPage devices={devices} inspect={inspect} {...deviceActions} />
              )}
              {page === 'users' && <UsersPage version={versions.users} edit={editing => open({ kind: 'user', user: editing })} onError={handleError} />}
              {page === 'activity' && <ActivityPage version={versions.activity} onError={handleError} />}
              {page === 'settings' && (
                <SettingsPage user={user} saved={() => showToast({ text: 'Contraseña actualizada. Tu acceso está listo.', critical: false })} />
              )}
            </>
          )}
          <footer className="main-footer">
            <span>Mining System <span className="dot-separator">·</span> Central de operaciones</span>
            <span>Hora de la central: Bolivia (UTC−4)</span>
          </footer>
        </main>
      </div>

      <div className="toast-stack">
        {alerts[0] && (
          <Toast
            text={alerts[0].text}
            critical
            more={alerts.length - 1}
            close={closeAlerts}
            action={{ label: alerts.length > 1 ? 'Ver alertas' : 'Ver alerta', run: () => { navigate('alerts'); closeAlerts() } }}
          />
        )}
        {notice && (
          <Toast
            text={notice.text}
            critical={false}
            close={closeNotice}
            action={notice.target && { label: notice.target.label, run: () => { navigate(notice.target!.page); closeNotice() } }}
          />
        )}
      </div>
      {dialog?.kind === 'user' && <UserForm user={dialog.user} close={closeDialog} saved={() => bump('users', 'devices', 'summary', 'activity')} />}
      {dialog?.kind === 'device' && (
        <DeviceForm
          device={dialog.device}
          miners={miners}
          close={closeDialog}
          saved={key => {
            setDialog(key ? { kind: 'key', apiKey: key } : null)
            bump('devices', 'summary', 'activity')
            if (!key) showToast({ text: 'Manilla actualizada.', critical: false })
          }}
        />
      )}
      {dialog?.kind === 'key' && <KeyModal apiKey={dialog.apiKey} close={closeDialog} />}
      {dialog?.kind === 'telemetry' && telemetryDevice && (
        <TelemetryModal device={telemetryDevice} live={live.series[telemetryDevice.id] ?? []} close={closeDialog} onError={handleError} />
      )}
      {dialog?.kind === 'notice' && overview && (
        <NoticeForm
          catalog={overview.noticeCatalog}
          devices={devices}
          initialDeviceId={dialog.deviceId}
          close={closeDialog}
          sent={count => {
            setDialog(null)
            // Created means queued: delivery and reading are confirmed later by the manilla.
            showToast({ text: count === 1 ? 'Aviso en cola para la manilla: pendiente de entrega.' : `Aviso en cola para ${count} manillas: pendiente de entrega.`, critical: false, target: { page: 'notices', label: 'Ver estado' } })
            bump('notices', 'summary', 'activity')
          }}
        />
      )}
      {dialog?.kind === 'rotate' && (
        <ConfirmModal
          title="Renovar credencial"
          subtitle={dialog.device.name}
          error={actionError}
          busy={busy}
          confirmLabel="Generar nueva credencial"
          busyLabel="Renovando…"
          icon={<KeyRound size={16} />}
          onConfirm={() => void rotate(dialog.device)}
          close={closeDialog}
        >
          <p>La credencial actual dejará de funcionar y la manilla se desconectará. Copia la nueva en su configuración para volver a conectarla.</p>
        </ConfirmModal>
      )}
      {dialog?.kind === 'review' && (
        <ConfirmModal
          title="Registrar revisión"
          subtitle={`${dialog.message.text} · ${dialog.message.minerName}`}
          error={actionError}
          busy={busy}
          confirmLabel="Marcar como revisada"
          busyLabel="Guardando…"
          icon={<CheckCheck size={16} />}
          onConfirm={() => void review(dialog.message)}
          close={closeDialog}
        >
          <p>
            La alerta se marcará como revisada por <strong>{user.name}</strong>. Esta acción registra tu revisión en la central;
            no envía una respuesta ni confirma que el incidente fue resuelto.
          </p>
        </ConfirmModal>
      )}
    </div>
    </LinkContext.Provider>
  )
}
