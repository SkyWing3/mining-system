import { useState } from 'react'
import type { ReactNode } from 'react'
import { Battery, CircleHelp, Cpu, Edit3, Eye, KeyRound, MapPin, Megaphone, Plus, Thermometer, Wind } from 'lucide-react'
import { DeviceStatus, LevelBadge } from '../components/devices/DeviceIndicators'
import { Empty } from '../components/ui/Feedback'
import { SearchField, Tooltip } from '../components/ui/controls'
import type { Device } from '../types/domain'
import { date, gas, percent, temperature } from '../utils/format'

export function DevicesPage({ devices, edit, rotate, inspect, notify, add }: {
  devices: Device[]
  edit: (device: Device) => void
  rotate: (device: Device) => void
  inspect: (device: Device) => void
  notify: (device: Device) => void
  add: () => void
}) {
  const [search, setSearch] = useState('')
  const term = search.toLowerCase()
  const items = devices.filter(device => `${device.name} ${device.minerName ?? ''} ${device.zone}`.toLowerCase().includes(term))
  return (
    <section className="panel">
      <div className="table-toolbar">
        <SearchField label="Buscar manillas" value={search} onChange={setSearch} placeholder="Buscar manilla, minero o zona…" />
        <span>{devices.length} dispositivos registrados</span>
      </div>
      {items.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>MANILLA / MINERO</th><th>ZONA</th><th>CONEXIÓN</th><th>NIVEL</th><th>TEMPERATURA</th><th>GAS</th><th>BATERÍA</th>
                <th><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map(device => (
                <tr key={device.id}>
                  <td>
                    <div className="table-person">
                      <span className="table-device-icon"><Cpu size={19} /></span>
                      <div><strong>{device.name}</strong><small>{device.minerName ?? 'Sin asignar'}</small></div>
                    </div>
                  </td>
                  <td><span className="zone-cell"><MapPin size={14} />{device.zone}</span></td>
                  <td><DeviceStatus device={device} /><small className="last-seen">{date(device.lastSeenAt, true)}</small></td>
                  <td>{device.reading ? <LevelBadge level={device.reading.level} /> : <span className="muted">—</span>}</td>
                  <td><span className="reading-cell"><Thermometer size={15} />{temperature(device.reading?.temperatureC)}</span></td>
                  <td><span className="reading-cell"><Wind size={15} />{gas(device.reading)}</span></td>
                  <td><span className="reading-cell"><Battery size={16} />{percent(device.reading?.batteryPercent)}</span></td>
                  <td>
                    <div className="row-actions">
                      <RowAction label="Ver lecturas" target={device.name} icon={<Eye size={17} />} run={() => inspect(device)} />
                      <RowAction label="Enviar aviso" accessibleLabel={`Enviar aviso a ${device.name}`} icon={<Megaphone size={17} />} run={() => notify(device)} disabled={!device.active} />
                      <RowAction label="Editar manilla" accessibleLabel={`Editar ${device.name}`} icon={<Edit3 size={17} />} run={() => edit(device)} />
                      <RowAction label="Renovar credencial" target={device.name} icon={<KeyRound size={17} />} run={() => rotate(device)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title={search ? 'No encontramos manillas' : 'Tu equipo empieza aquí'}
          text={search ? 'Prueba con otro nombre o zona.' : 'Registra una manilla y asígnala a un minero para recibir sus reportes.'}
          action={!search && <button className="button primary" onClick={add}><Plus size={16} />Registrar manilla</button>}
        />
      )}
      <div className="panel-bottom-note">
        <CircleHelp size={15} />Las lecturas se actualizan en vivo con cada envío de la manilla. Una manilla sin señal reciente aparece sin conexión.
      </div>
    </section>
  )
}

function RowAction({ label, target, accessibleLabel, icon, run, disabled = false }: {
  label: string
  target?: string
  accessibleLabel?: string
  icon: ReactNode
  run: () => void
  disabled?: boolean
}) {
  return (
    <Tooltip text={label}>
      <button className="icon-button" aria-label={accessibleLabel ?? `${label} de ${target}`} onClick={run} disabled={disabled}>{icon}</button>
    </Tooltip>
  )
}
