import { useEffect, useState } from 'react'
import { Edit3, ShieldCheck } from 'lucide-react'
import { loadWithRecovery } from '../api/client'
import { usersApi } from '../api/endpoints'
import { Chip, Empty } from '../components/ui/Feedback'
import { SearchField, Select } from '../components/ui/controls'
import type { User } from '../types/domain'
import { date, initials, roleName } from '../utils/format'

export function UsersPage({ version, edit, onError }: { version: number; edit: (user: User) => void; onError: (error: unknown) => void }) {
  const [users, setUsers] = useState<User[]>([])
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')

  useEffect(() => loadWithRecovery(signal => usersApi.list(signal), setUsers, onError), [version, onError])

  const term = search.toLowerCase()
  const items = users.filter(user => `${user.name} ${user.email}`.toLowerCase().includes(term) && (!role || user.role === role))
  return (
    <section className="panel">
      <div className="table-toolbar">
        <SearchField label="Buscar usuarios" value={search} onChange={setSearch} placeholder="Buscar nombre o correo…" />
        <Select
          aria-label="Filtrar rol"
          value={role}
          onChange={setRole}
          options={[{ value: '', label: 'Todos los roles' }, ...Object.entries(roleName).map(([value, label]) => ({ value, label }))]}
        />
        <span className="table-count"><b className="mono">{users.length}</b> usuarios registrados</span>
      </div>
      {items.length ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>USUARIO</th><th>ROL</th><th>ESTADO</th><th>FECHA DE REGISTRO</th><th><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>
              {items.map(user => (
                <tr key={user.id}>
                  <td className="cell-main" data-label="Usuario">
                    <div className="table-person">
                      <span className="avatar neutral" aria-hidden="true">{initials(user.name)}</span>
                      <div><strong>{user.name}</strong><small>{user.email}</small></div>
                    </div>
                  </td>
                  <td data-label="Rol"><Chip tone={user.role === 'Admin' ? 'solid' : user.role === 'Miner' ? 'brand' : 'outline'} className="role-badge">{roleName[user.role]}</Chip></td>
                  <td data-label="Estado"><span className={`account-status ${user.active ? 'active' : ''}`}><span aria-hidden="true" />{user.active ? 'Activo' : 'Inactivo'}</span></td>
                  <td className="muted mono" data-label="Registro">{date(user.createdAt, true)}</td>
                  <td className="cell-actions" data-label="Acciones">
                    <button className="button secondary small-button" onClick={() => edit(user)}><Edit3 size={15} />Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty title="Sin usuarios en esta vista" text="Prueba otro nombre o selecciona un rol diferente." />}
      <div className="panel-bottom-note"><ShieldCheck size={15} />Las cuentas y las asignaciones se conservan al desactivarlas para mantener el historial.</div>
    </section>
  )
}
