import { ArrowRight, ArrowUpRight, ChevronRight, HardHat, MapPin, MessageSquare, OctagonAlert, Plus, Radio, ShieldCheck, Thermometer, TriangleAlert } from 'lucide-react'
import { DeviceStatus, LevelBadge } from '../components/devices/DeviceIndicators'
import { MessageRows } from '../components/messages/MessageRows'
import { Empty, PanelHeading, Stat } from '../components/ui/Feedback'
import type { Device, Message, Overview, Page } from '../types/domain'
import { temperature } from '../utils/format'

export function DashboardPage({ overview, devices, liveDanger, navigate, review, inspect }: {
  overview: Overview
  devices: Device[]
  liveDanger: number
  navigate: (page: Page) => void
  review: (message: Message) => void
  inspect: (device: Device) => void
}) {
  const active = devices.filter(device => device.active)
  const online = active.filter(device => device.online)
  return (
    <>
      <div className="stats-grid">
        <Stat label="MINEROS REGISTRADOS" value={overview.activeMiners} icon={<HardHat size={21} />} note="Personal con cuenta activa" />
        <Stat
          label="MANILLAS CONECTADAS"
          value={<>{online.length}<small> / {active.length}</small></>}
          icon={<Radio size={21} />}
          note="Enlace registrado en los últimos 90 s"
        />
        <Stat label="MENSAJES DE HOY" value={overview.messagesToday} icon={<MessageSquare size={21} />} note="Recibidos en la jornada local" />
        <Stat
          label="ALERTAS PENDIENTES"
          value={overview.pendingAlerts}
          icon={<TriangleAlert size={21} />}
          note={overview.pendingAlerts ? 'Reportes críticos por revisar' : 'Sin reportes críticos pendientes'}
          alert
        />
      </div>
      {liveDanger > 0 && (
        <div className="alert-callout danger-callout" role="alert">
          <span className="alert-callout-icon"><OctagonAlert size={22} /></span>
          <div>
            <strong>{liveDanger === 1 ? 'Una manilla informa peligro' : `${liveDanger} manillas informan peligro`}</strong>
            <p>Sus sensores superaron el umbral de peligro configurado en la manilla.</p>
          </div>
          <button className="text-button" onClick={() => navigate('live')}>Ver lecturas<ArrowRight size={17} /></button>
        </div>
      )}
      {overview.pendingAlerts > 0 && (
        <div className="alert-callout">
          <span className="alert-callout-icon"><TriangleAlert size={22} /></span>
          <div>
            <strong>{overview.pendingAlerts === 1 ? 'Hay un reporte que requiere tu atención' : `${overview.pendingAlerts} reportes requieren tu atención`}</strong>
            <p>Consulta las alertas de tu equipo y registra su revisión.</p>
          </div>
          <button className="text-button" onClick={() => navigate('alerts')}>Ver alertas<ArrowRight size={17} /></button>
        </div>
      )}
      <div className="dashboard-grid">
        <section className="panel recent-panel">
          <PanelHeading
            title="Últimos mensajes"
            subtitle="Reportes enviados desde el terreno"
            action={<button className="text-button" onClick={() => navigate('messages')}>Ver todos<ArrowUpRight size={16} /></button>}
          />
          {overview.recentMessages.length
            ? <MessageRows messages={overview.recentMessages.slice(0, 5)} review={review} compact />
            : <Empty title="Aquí comienza la comunicación" text="Los reportes de las manillas aparecerán aquí al instante." />}
          <div className="panel-bottom-note"><ShieldCheck size={15} />Canal de recepción de mensajes del equipo</div>
        </section>
        <Coverage active={active.length} online={online.length} navigate={navigate} />
      </div>
      <div className="dashboard-bottom-grid">
        <section className="panel">
          <PanelHeading
            title="Equipo en el terreno"
            subtitle="Conexión y última medición recibida en vivo"
            action={<button className="text-button" onClick={() => navigate('live')}>Ver en vivo<ArrowUpRight size={16} /></button>}
          />
          {active.length ? (
            <div className="team-list">
              {active.slice(0, 4).map(device => (
                <button className="team-row" key={device.id} onClick={() => inspect(device)}>
                  <span className="avatar neutral"><HardHat size={20} strokeWidth={1.6} /></span>
                  <span className="team-person">
                    <strong>{device.minerName ?? 'Sin asignar'}</strong>
                    <small>{device.name} · {device.zone}</small>
                  </span>
                  <span className="team-meta">
                    <span className="team-reading">
                      <Thermometer size={15} />
                      {device.reading?.temperatureC == null ? 'Sin lectura' : temperature(device.reading.temperatureC)}
                    </span>
                    {device.reading && device.reading.level !== 'normal' && <LevelBadge level={device.reading.level} />}
                    <DeviceStatus device={device} />
                  </span>
                  <ChevronRight className="team-chevron" size={16} />
                </button>
              ))}
            </div>
          ) : (
            <Empty
              title="Conecta tu primera manilla"
              text="Registra un dispositivo y asígnalo a un minero para comenzar."
              action={<button className="button secondary" onClick={() => navigate('devices')}><Plus size={16} />Ir a manillas</button>}
            />
          )}
        </section>
        <Zones devices={active} />
      </div>
    </>
  )
}

function Coverage({ active, online, navigate }: { active: number; online: number; navigate: (page: Page) => void }) {
  const coverage = active ? Math.round((online / active) * 100) : 0
  return (
    <section className="panel coverage-panel">
      <PanelHeading title="Cobertura del equipo" subtitle="Disponibilidad de las manillas activas" />
      <div className="coverage-ring">
        <svg viewBox="0 0 160 160" aria-hidden="true">
          <circle cx="80" cy="80" r="65" fill="none" stroke="var(--chart-grid)" strokeWidth="11" />
          {coverage > 0 && (
            <circle
              cx="80"
              cy="80"
              r="65"
              fill="none"
              stroke="var(--accent-plum)"
              strokeWidth="11"
              strokeDasharray={`${(coverage / 100) * 408.4} 408.4`}
              transform="rotate(-90 80 80)"
              strokeLinecap="round"
            />
          )}
        </svg>
        <div><strong>{coverage}<small>%</small></strong><span>conectadas</span></div>
      </div>
      <div className="coverage-legend">
        <span><i className="legend-dot online" />Conectadas<strong>{online}</strong></span>
        <span><i className="legend-dot offline" />Sin conexión<strong>{active - online}</strong></span>
      </div>
      <button className="button secondary coverage-link" onClick={() => navigate('devices')}>Gestionar manillas<ArrowRight size={16} /></button>
    </section>
  )
}

function Zones({ devices }: { devices: Device[] }) {
  const zones = [...new Set(devices.map(device => device.zone))]
  return (
    <section className="panel zones-panel">
      <PanelHeading title="Zonas de trabajo" subtitle="Distribución de manillas registradas" />
      {zones.length ? (
        <div className="zone-list">
          {zones.slice(0, 5).map(zone => {
            const count = devices.filter(device => device.zone === zone).length
            return (
              <div className="zone-row" key={zone}>
                <div>
                  <span><MapPin size={15} />{zone}</span>
                  <strong>{count}<small> {count === 1 ? 'manilla' : 'manillas'}</small></strong>
                </div>
                <div className="zone-track"><span style={{ width: `${(count / devices.length) * 100}%` }} /></div>
              </div>
            )
          })}
        </div>
      ) : <Empty title="Sin zonas registradas" text="Las zonas se definen al registrar cada manilla." />}
    </section>
  )
}
