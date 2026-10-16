import { memo, useContext, useId } from 'react'
import { ArrowRight, ArrowUpRight, ChevronRight, CircleCheck, HardHat, MapPin, Megaphone, MessageSquare, Mic, OctagonAlert, Plus, Radio, ShieldCheck, TriangleAlert, WifiOff } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { DeviceStatus, LevelBadge, ReadingOrigin } from '../components/devices/DeviceIndicators'
import { MessageRows } from '../components/messages/MessageRows'
import { Empty, PanelHeading, Stat } from '../components/ui/Feedback'
import { LinkContext, presenceKnown } from '../realtime/LinkContext'
import type { Device, Message, Overview, Page } from '../types/domain'
import { date, gas, isUncalibrated, levelName, plural, temperature } from '../utils/format'
import { levelRank } from '../utils/levels'

const ROSTER_ROWS = 8

export function DashboardPage({ overview, devices, dangerNow, dangerLost, navigate, review, inspect }: {
  overview: Overview
  devices: Device[]
  dangerNow: Device[]
  dangerLost: Device[]
  navigate: (page: Page) => void
  review: (message: Message) => void
  inspect: (device: Device) => void
}) {
  const known = presenceKnown(useContext(LinkContext))
  const active = devices.filter(device => device.active)
  const online = active.filter(device => device.online)
  const roster = [...active].sort((a, b) => levelRank(b) - levelRank(a) || a.name.localeCompare(b.name))
  return (
    <>
      <StatusBoard overview={overview} active={active} online={online} dangerNow={dangerNow} dangerLost={dangerLost} linkOnline={known} navigate={navigate} inspect={inspect} />
      <div className="stats-grid">
        <Stat label="Mineros registrados" value={overview.activeMiners} icon={<HardHat size={16} />} note="Personal con cuenta activa" />
        <Stat
          label="Manillas conectadas"
          value={<>{known ? online.length : '—'}<small> / {active.length}</small></>}
          icon={<Radio size={16} />}
          note={known ? 'Enlace registrado en los últimos 90 s' : 'Desconocido mientras no haya enlace en vivo'}
          meter={known && active.length ? online.length / active.length : 0}
        />
        <Stat label="Mensajes de hoy" value={overview.messagesToday} icon={<MessageSquare size={16} />} note="Recibidos en la jornada local" />
        <Stat
          label="Alertas pendientes"
          value={overview.pendingAlerts}
          icon={<TriangleAlert size={16} />}
          note={overview.pendingAlerts ? 'Reportes críticos por revisar' : 'Sin reportes críticos pendientes'}
          alert={overview.pendingAlerts > 0}
        />
        <Stat label="Voz sin escuchar" value={overview.pendingVoice} icon={<Mic size={16} />} note="Grabaciones aún sin revisar" />
        <Stat label="Avisos sin leer" value={overview.pendingNotices} icon={<Megaphone size={16} />} note="Vigentes, sin confirmar en la manilla" />
      </div>
      <div className="dashboard-grid">
        <section className="panel roster-panel">
          <PanelHeading
            title="Equipo en el terreno"
            subtitle="Última medición recibida en vivo, ordenada por nivel de alerta"
            action={<button className="text-button" onClick={() => navigate('live')}>Ver en vivo<ArrowUpRight size={16} /></button>}
          />
          {active.length ? (
            <div className="team-list">
              <div className="team-head" aria-hidden="true">
                <span>Minero</span><span>CO</span><span>Ambiente</span><span>Objeto</span><span>Estado</span>
              </div>
              {roster.slice(0, ROSTER_ROWS).map(device => <TeamRow key={device.id} device={device} inspect={inspect} />)}
              {roster.length > ROSTER_ROWS && (
                <button className="team-more text-button" onClick={() => navigate('live')}>
                  Ver las {roster.length} manillas en vivo<ArrowRight size={15} />
                </button>
              )}
            </div>
          ) : (
            <Empty
              title="Conecta tu primera manilla"
              text="Registra un dispositivo y asígnalo a un minero para comenzar."
              action={<button className="button secondary" onClick={() => navigate('devices')}><Plus size={16} />Ir a manillas</button>}
            />
          )}
        </section>
        <div className="dashboard-side">
          <section className="panel recent-panel">
            <PanelHeading
              title="Últimos mensajes"
              subtitle="Reportes enviados desde el terreno"
              action={<button className="text-button" onClick={() => navigate('messages')}>Ver todos<ArrowUpRight size={16} /></button>}
            />
            {overview.recentMessages.length
              ? <MessageRows messages={overview.recentMessages.slice(0, 5)} review={review} compact />
              : <Empty title="Aquí comienza la comunicación" text="Los reportes de las manillas aparecerán aquí al instante." />}
            <div className="panel-bottom-note"><ShieldCheck size={15} aria-hidden="true" />Canal de recepción de mensajes del equipo</div>
          </section>
          <Zones devices={active} />
        </div>
      </div>
    </>
  )
}

interface Condition {
  tone: 'danger' | 'warn' | 'neutral'
  icon: LucideIcon
  title: string
  text: string
  action: { label: string; run: () => void }
}

const who = (device: Device) => `${device.minerName ?? 'Sin asignar'} · ${device.name}`
const readingSummary = (device: Device) => `CO ${gas(device.reading)} · Ambiente ${temperature(device.reading?.temperatureC)}`

// Every condition comes from data the central already has; nothing is declared safe without readings.
function StatusBoard({ overview, active, online, dangerNow, dangerLost, linkOnline, navigate, inspect }: {
  overview: Overview
  active: Device[]
  online: Device[]
  dangerNow: Device[]
  dangerLost: Device[]
  linkOnline: boolean
  navigate: (page: Page) => void
  inspect: (device: Device) => void
}) {
  const caution = online.filter(device => device.reading?.level === 'caution')
  const offline = active.filter(device => !device.online && device.reading?.level !== 'danger')
  const pendingCritical = overview.recentMessages.find(message => message.severity === 'critical' && !message.reviewedAt)
  const conditions: Condition[] = []
  if (!linkOnline) conditions.push({
    tone: 'neutral',
    icon: WifiOff,
    title: 'Sin enlace en vivo con la central',
    text: 'Lo que ves es el último dato recibido: el estado de cada manilla puede haber cambiado.',
    action: { label: 'Ver manillas', run: () => navigate('devices') },
  })
  if (dangerNow.length) conditions.push({
    tone: 'danger',
    icon: OctagonAlert,
    title: dangerNow.length === 1 ? `${who(dangerNow[0])} informa peligro` : `${dangerNow.length} manillas informan peligro`,
    text: dangerNow.length === 1
      ? `${dangerNow[0].zone} · ${readingSummary(dangerNow[0])}. Sus sensores superaron el umbral de peligro configurado en la manilla.`
      : `${dangerNow.map(device => `${device.minerName ?? device.name} (${device.zone})`).join(', ')}. Sus sensores superaron el umbral de peligro configurado en la manilla.`,
    action: dangerNow.length === 1
      ? { label: `Ver lecturas de ${dangerNow[0].name}`, run: () => inspect(dangerNow[0]) }
      : { label: 'Ver lecturas en vivo', run: () => navigate('live') },
  })
  if (dangerLost.length) conditions.push({
    tone: 'danger',
    icon: WifiOff,
    title: dangerLost.length === 1 ? `${who(dangerLost[0])} informaba peligro y perdió la señal` : `${dangerLost.length} manillas informaban peligro y perdieron la señal`,
    text: `Sin señal desde las ${date(dangerLost[0].lastSeenAt)} en ${dangerLost[0].zone}. Su estado actual es desconocido.`,
    action: { label: `Ver última lectura de ${dangerLost[0].name}`, run: () => inspect(dangerLost[0]) },
  })
  if (overview.pendingAlerts > 0) conditions.push({
    tone: 'danger',
    icon: TriangleAlert,
    title: overview.pendingAlerts === 1 ? 'Hay un reporte que requiere tu atención' : `${overview.pendingAlerts} reportes requieren tu atención`,
    text: pendingCritical
      ? `Último: «${pendingCritical.text}» de ${pendingCritical.minerName}, ${pendingCritical.zone}, a las ${date(pendingCritical.receivedAt)}. Registra su revisión en Alertas.`
      : 'Consulta las alertas de tu equipo y registra su revisión.',
    action: { label: 'Ver alertas', run: () => navigate('alerts') },
  })
  if (caution.length) conditions.push({
    tone: 'warn',
    icon: TriangleAlert,
    title: caution.length === 1 ? `${who(caution[0])} informa precaución` : `${caution.length} manillas informan precaución`,
    text: 'Sus lecturas superaron el umbral de precaución configurado en la manilla.',
    action: caution.length === 1
      ? { label: `Ver lecturas de ${caution[0].name}`, run: () => inspect(caution[0]) }
      : { label: 'Ver lecturas en vivo', run: () => navigate('live') },
  })
  if (linkOnline && offline.length) conditions.push({
    tone: 'neutral',
    icon: WifiOff,
    title: offline.length === 1 ? `${who(offline[0])} sin conexión` : `${offline.length} manillas sin conexión`,
    text: 'Sin enlace en los últimos 90 s: no hay lecturas recientes de ese equipo.',
    action: { label: 'Ver manillas', run: () => navigate('devices') },
  })
  if (overview.pendingVoice > 0) conditions.push({
    tone: 'neutral',
    icon: Mic,
    title: overview.pendingVoice === 1 ? 'Un mensaje de voz sin escuchar' : `${overview.pendingVoice} mensajes de voz sin escuchar`,
    text: 'Grabaciones enviadas desde el micrófono de las manillas.',
    action: { label: 'Escuchar', run: () => navigate('voice') },
  })

  // A safety condition outranks the link notice for the headline; the link notice stays in the list.
  const ordered = [...conditions].sort((a, b) => Number(b.tone === 'danger') - Number(a.tone === 'danger'))
  const [headline, ...others] = ordered
  const tone = headline?.tone ?? (active.length ? 'ok' : 'neutral')
  const Icon = headline?.icon ?? (active.length ? CircleCheck : Radio)
  return (
    <section className={`status-board ${tone}`} aria-labelledby="status-board-title">
      <div className="status-board-main">
        <span className="status-board-icon" aria-hidden="true"><Icon size={24} strokeWidth={2} /></span>
        <div className="status-board-text">
          <h2 id="status-board-title" className="status-board-label">Estado de la operación</h2>
          <strong>{headline?.title ?? (active.length ? 'Sin alertas activas' : 'Sin manillas habilitadas')}</strong>
          <p>
            {headline?.text ?? (active.length
              ? 'Las manillas conectadas informan nivel normal y no hay reportes críticos pendientes.'
              : 'Registra una manilla para comenzar a monitorear al equipo.')}
          </p>
        </div>
        {headline && (
          <button className={`button ${headline.tone === 'danger' ? 'danger' : 'secondary'}`} onClick={headline.action.run}>
            {headline.action.label}<ArrowRight size={16} />
          </button>
        )}
      </div>
      {others.length > 0 && (
        <ul className="status-board-list">
          {others.map(condition => (
            <li key={condition.title} className={condition.tone}>
              <condition.icon size={16} aria-hidden="true" />
              <span>{condition.title}</span>
              <button className="text-button" onClick={condition.action.run}>{condition.action.label}<ArrowRight size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const TeamRow = memo(function TeamRow({ device, inspect }: { device: Device; inspect: (device: Device) => void }) {
  const reading = device.reading
  const id = useId()
  // Screen readers hear who and the level first; the readings follow as the description.
  const name = `${device.minerName ?? 'Sin asignar'}, ${device.name}, ${device.zone}: ${reading ? levelName[reading.level].toLowerCase() : 'sin lectura'}. Ver lecturas`
  // The last known level stays visible when the signal is lost: danger followed by silence must not look calm.
  return (
    <button
      className={`team-row ${reading?.level ?? ''} ${device.online ? '' : 'offline'}`}
      aria-label={name}
      aria-describedby={`${id}-co ${id}-ambient ${id}-object ${id}-meta`}
      onClick={() => inspect(device)}
    >
      <span className="team-person">
        <strong>{device.minerName ?? 'Sin asignar'}</strong>
        <small>{device.name} · {device.zone}</small>
      </span>
      <span className="team-value mono" id={`${id}-co`}>
        <span className="sr-only">CO </span>{gas(reading)}
        {isUncalibrated(reading) && <small>sin calibrar</small>}
      </span>
      <span className="team-value team-reading mono" id={`${id}-ambient`}>
        <span className="sr-only">Ambiente </span>{reading?.temperatureC == null ? 'Sin lectura' : temperature(reading.temperatureC)}
      </span>
      <span className="team-value mono" id={`${id}-object`}><span className="sr-only">Objeto </span>{temperature(reading?.objectTemperatureC)}</span>
      <span className="team-meta" id={`${id}-meta`}>
        {reading && <LevelBadge level={reading.level} />}
        <DeviceStatus device={device} />
        <ReadingOrigin reading={reading} />
        {reading && <small className="mono">{date(reading.receivedAt)}</small>}
      </span>
      <ChevronRight className="team-chevron" size={16} aria-hidden="true" />
    </button>
  )
})

// Per zone: how many manillas and in which state, so a problem area stands out.
function Zones({ devices }: { devices: Device[] }) {
  const zones = [...new Set(devices.map(device => device.zone))]
  return (
    <section className="panel zones-panel">
      <PanelHeading title="Zonas de trabajo" subtitle="Manillas habilitadas y su estado actual" />
      {zones.length ? (
        <div className="zone-list">
          {zones.slice(0, 6).map(zone => {
            const inZone = devices.filter(device => device.zone === zone)
            const counts = {
              danger: inZone.filter(device => device.online && device.reading?.level === 'danger').length,
              caution: inZone.filter(device => device.online && device.reading?.level === 'caution').length,
              normal: inZone.filter(device => device.online && device.reading?.level === 'normal').length,
            }
            const unknown = inZone.length - counts.danger - counts.caution - counts.normal
            const parts = [
              counts.danger && plural(counts.danger, 'en peligro', 'en peligro'),
              counts.caution && plural(counts.caution, 'en precaución', 'en precaución'),
              counts.normal && plural(counts.normal, 'normal', 'normales'),
              unknown && plural(unknown, 'sin datos recientes', 'sin datos recientes'),
            ].filter(Boolean)
            return (
              <div className="zone-row" key={zone}>
                <div>
                  <span><MapPin size={15} aria-hidden="true" />{zone}</span>
                  <strong className="mono">{inZone.length}<small> {inZone.length === 1 ? 'manilla' : 'manillas'}</small></strong>
                </div>
                <div className="zone-track" aria-hidden="true">
                  {(['danger', 'caution', 'normal'] as const).map(state => counts[state] > 0 && (
                    <span key={state} className={state} style={{ width: `${(counts[state] / inZone.length) * 100}%` }} />
                  ))}
                </div>
                <p>{parts.join(' · ')}</p>
              </div>
            )
          })}
          {zones.length > 6 && <p className="zone-more">{plural(zones.length - 6, 'zona más', 'zonas más')} en la lista de manillas.</p>}
        </div>
      ) : <Empty title="Sin zonas registradas" text="Las zonas se definen al registrar cada manilla." />}
    </section>
  )
}
