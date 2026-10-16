import { memo, useState } from 'react'
import type { ReactNode } from 'react'
import { Battery, CircleHelp, Cpu, Edit3, Eye, KeyRound, MapPin, Megaphone, Plus, Thermometer, Wind } from 'lucide-react'
import { DeviceStatus, LevelBadge, ReadingOrigin } from '../components/devices/DeviceIndicators'
import { Empty } from '../components/ui/Feedback'
import { SearchField, Tooltip } from '../components/ui/controls'
import type { Device } from '../types/domain'
import { date, gas, isUncalibrated, percent, temperature } from '../utils/format'

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
        <span className="table-count"><b className="mono">{devices.length}</b> dispositivos registrados</span>
      </div>
      {items.length ? (
        <div className="table-scroll">
          <table className="data-table wide">
            <thead>
              <tr>
                <th>MANILLA / MINERO</th><th>ESTADO</th><th>LECTURAS</th>
                <th><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map(device => <DeviceRow key={device.id} device={device} inspect={inspect} notify={notify} edit={edit} rotate={rotate} />)}
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

const DeviceRow = memo(function DeviceRow({ device, inspect, notify, edit, rotate }: {
  device: Device
  inspect: (device: Device) => void
  notify: (device: Device) => void
  edit: (device: Device) => void
  rotate: (device: Device) => void
}) {
  return (
    <tr>
      <td className="cell-main cell-wrap" data-label="Manilla">
        <div className="table-person">
          <span className="table-device-icon" aria-hidden="true"><Cpu size={18} /></span>
          <div>
            <strong>{device.name}</strong>
            <small>{device.minerName ?? 'Sin asignar'}</small>
            <small className="zone-cell"><MapPin size={13} />{device.zone}</small>
          </div>
        </div>
      </td>
      <td data-label="Estado">
        <div className="cell-stack">
          <div className="badge-row">
            <DeviceStatus device={device} />
            {device.reading && <LevelBadge level={device.reading.level} />}
          </div>
          <small className="last-seen mono">{date(device.lastSeenAt, true)}</small>
        </div>
      </td>
      <td data-label="Lecturas">
        <div className="reading-group">
          <span className="reading-cell"><Wind size={15} aria-hidden="true" /><span className="reading-label">{isUncalibrated(device.reading) ? 'CO (sin calibrar)' : 'CO'}</span><span className="mono">{gas(device.reading)}</span></span>
          <span className="reading-cell"><Thermometer size={15} aria-hidden="true" /><span className="reading-label">Ambiente</span><span className="mono">{temperature(device.reading?.temperatureC)}</span></span>
          <span className="reading-cell"><Thermometer size={15} aria-hidden="true" /><span className="reading-label">Objeto</span><span className="mono">{temperature(device.reading?.objectTemperatureC)}</span></span>
          <span className="reading-cell"><Battery size={16} aria-hidden="true" /><span className="reading-label">Batería</span><span className="mono">{!device.reading ? '—' : device.reading.batteryPercent == null ? 'Sin sensor' : percent(device.reading.batteryPercent)}</span></span>
          <ReadingOrigin reading={device.reading} />
        </div>
      </td>
      <td className="cell-actions" data-label="Acciones">
        <div className="row-actions">
          <RowAction label="Ver lecturas" target={device.name} icon={<Eye size={17} />} run={() => inspect(device)} />
          <RowAction label="Enviar aviso" accessibleLabel={`Enviar aviso a ${device.name}`} icon={<Megaphone size={17} />} run={() => notify(device)} disabled={!device.active} />
          <RowAction label="Editar manilla" accessibleLabel={`Editar ${device.name}`} icon={<Edit3 size={17} />} run={() => edit(device)} />
          <RowAction label="Renovar credencial" target={device.name} icon={<KeyRound size={17} />} run={() => rotate(device)} />
        </div>
      </td>
    </tr>
  )
})

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
