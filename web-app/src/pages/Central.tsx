import { useCallback, useMemo, useState } from 'react'
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
import { pageInfo } from '../layout/pages'
import { Sidebar } from '../layout/Sidebar'
import { Toast, Topbar } from '../layout/Topbar'
import { useLiveTelemetry } from '../realtime/liveTelemetry'
import { useRealtime } from '../realtime/useRealtime'
import type { RealtimeHandlers } from '../realtime/useRealtime'
import type { ChangeCategory, Device, Message, Page, User } from '../types/domain'
import { ActivityPage } from './ActivityPage'
import { AnalyticsPage } from './AnalyticsPage'
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
  const [toast, setToast] = useState<ToastState | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const live = useLiveTelemetry()

  const handleError = useCallback((failure: unknown) => {
    if (failure instanceof ApiError && failure.status === 401) signOut()
    else setError((failure as Error).message)
  }, [signOut])
  const clearError = useCallback(() => setError(''), [])
  const { overview, devices, miners, loading, applyTelemetry, applyMessage } = useCentralData(versions, handleError, clearError)

  const { append } = live
  const handlers = useMemo<RealtimeHandlers>(() => ({
    messageReceived: message => {
      applyMessage(message)
      setToast({
        text: `${message.minerName}: ${message.text}${message.detail ? ` (${message.detail})` : ''}`,
        critical: message.severity === 'critical',
        target: message.severity === 'critical' ? { page: 'alerts', label: 'Ver alerta' } : undefined,
      })
      bump('summary', 'messages', 'activity', 'analytics')
    },
    messageReviewed: () => bump('summary', 'messages', 'activity', 'analytics'),
    telemetryReceived: event => {
      applyTelemetry(event)
      append(event.deviceId, event.reading)
      bump('analytics')
    },
    voiceMessageReceived: voice => {
      setToast({ text: `${voice.minerName} envió un mensaje de voz.`, critical: false, target: { page: 'voice', label: 'Escuchar' } })
      bump('summary', 'voice')
    },
    voiceMessageReviewed: () => bump('summary', 'voice', 'activity'),
    noticeUpdated: () => bump('notices', 'summary'),
    systemChanged: category => bump(...(changeScopes[category] ?? [])),
    resynchronize: () => {
      bump()
      setResync(value => value + 1)
    },
  }), [applyMessage, applyTelemetry, append, bump])
  const connection = useRealtime(user.id, handlers)

  const navigate = useCallback((next: Page) => {
    setPage(next)
    setSidebarOpen(false)
    setError('')
    setActionError('')
  }, [])
  const closeDialog = useCallback(() => setDialog(null), [])
  const closeToast = useCallback(() => setToast(null), [])
  const open = (next: Dialog) => {
    setActionError('')
    setDialog(next)
  }

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
    setToast({ text: 'La revisión quedó registrada.', critical: false })
    bump('summary', 'messages')
  })

  const rotate = (device: Device) => runAction(async () => {
    const result = await devicesApi.rotateKey(device.id)
    setDialog({ kind: 'key', apiKey: result.apiKey })
    bump('devices')
  })

  async function logout() {
    try {
      await authApi.logout()
      signOut()
    } catch (failure) {
      handleError(failure)
    }
  }

  const liveDanger = devices.filter(device => device.active && device.online && device.reading?.level === 'danger').length
  const telemetryDevice = dialog?.kind === 'telemetry' ? devices.find(device => device.id === dialog.deviceId) : undefined
  const inspect = (device: Device) => open({ kind: 'telemetry', deviceId: device.id })
  const headingAction = {
    users: <button className="button primary" onClick={() => open({ kind: 'user', user: null })}><Plus size={17} />Crear usuario</button>,
    devices: <button className="button primary" onClick={() => open({ kind: 'device', device: null })}><Plus size={17} />Registrar manilla</button>,
    notices: <button className="button primary" onClick={() => open({ kind: 'notice' })}><Megaphone size={17} />Enviar aviso</button>,
  }[page as 'users' | 'devices' | 'notices']

  return (
    <div className="app-shell">
      {sidebarOpen && <button className="sidebar-overlay" aria-label="Cerrar navegación" onClick={() => setSidebarOpen(false)} />}
      <Sidebar
        user={user}
        page={page}
        open={sidebarOpen}
        counts={{ alerts: overview?.pendingAlerts, voice: overview?.pendingVoice, live: liveDanger }}
        navigate={navigate}
        logout={() => void logout()}
      />
      <div className="workspace">
        <Topbar
          user={user}
          title={pageInfo[page].title}
          pendingAlerts={overview?.pendingAlerts ?? 0}
          openNavigation={() => setSidebarOpen(true)}
          showAlerts={() => navigate('alerts')}
        />
        <main className="main-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">{page === 'dashboard' ? 'TU OPERACIÓN, CONECTADA' : 'MINING SYSTEM'}</span>
              <h1>{pageInfo[page].title}</h1>
              <p>{pageInfo[page].description}</p>
            </div>
            {headingAction && <div className="page-heading-actions">{headingAction}</div>}
          </div>
          {connection !== 'online' && (
            <div className="connection-warning" role="status">
              <WifiOff size={17} />El enlace en vivo se está restableciendo. Los datos visibles pueden estar desactualizados.
            </div>
          )}
          {error && <div className="error-banner" role="alert"><TriangleAlert size={18} /><span>{error}</span></div>}
          {loading || !overview ? <Spinner label="Cargando la operación…" /> : (
            <>
              {page === 'dashboard' && (
                <DashboardPage
                  overview={overview}
                  devices={devices}
                  liveDanger={liveDanger}
                  navigate={navigate}
                  review={message => open({ kind: 'review', message })}
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
                  review={message => open({ kind: 'review', message })}
                  onError={handleError}
                />
              )}
              {page === 'voice' && <VoicePage version={versions.voice} devices={devices} onError={handleError} />}
              {page === 'notices' && <NoticesPage version={versions.notices} compose={() => open({ kind: 'notice' })} onError={handleError} />}
              {page === 'devices' && (
                <DevicesPage
                  devices={devices}
                  edit={device => open({ kind: 'device', device })}
                  rotate={device => open({ kind: 'rotate', device })}
                  inspect={inspect}
                  notify={device => open({ kind: 'notice', deviceId: device.id })}
                  add={() => open({ kind: 'device', device: null })}
                />
              )}
              {page === 'users' && <UsersPage version={versions.users} edit={editing => open({ kind: 'user', user: editing })} onError={handleError} />}
              {page === 'analytics' && <AnalyticsPage version={versions.analytics} onError={handleError} />}
              {page === 'activity' && <ActivityPage version={versions.activity} onError={handleError} />}
              {page === 'settings' && (
                <SettingsPage user={user} saved={() => setToast({ text: 'Contraseña actualizada. Tu acceso está listo.', critical: false })} />
              )}
            </>
          )}
          <footer className="main-footer">
            <span>MINING SYSTEM <span className="dot-separator">·</span> Seguridad conectada</span>
            <span>Hora de la central: Bolivia (UTC−4)</span>
          </footer>
        </main>
      </div>

      {toast && (
        <Toast
          text={toast.text}
          critical={toast.critical}
          close={closeToast}
          action={toast.target && {
            label: toast.target.label,
            run: () => {
              navigate(toast.target!.page)
              setToast(null)
            },
          }}
        />
      )}
      {dialog?.kind === 'user' && <UserForm user={dialog.user} close={closeDialog} saved={() => bump('users', 'devices', 'summary', 'activity')} />}
      {dialog?.kind === 'device' && (
        <DeviceForm
          device={dialog.device}
          miners={miners}
          close={closeDialog}
          saved={key => {
            setDialog(key ? { kind: 'key', apiKey: key } : null)
            bump('devices', 'summary', 'activity')
            if (!key) setToast({ text: 'Manilla actualizada.', critical: false })
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
            setToast({ text: count === 1 ? 'Aviso enviado a la manilla.' : `Aviso enviado a ${count} manillas.`, critical: false, target: { page: 'notices', label: 'Ver estado' } })
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
  )
}
