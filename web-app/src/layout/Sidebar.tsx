import { memo } from 'react'
import { LogOut } from 'lucide-react'
import { Brand } from '../components/ui/Brand'
import { Tooltip } from '../components/ui/controls'
import type { Page, User } from '../types/domain'
import { initials, roleName } from '../utils/format'
import { pageInfo } from './pages'
import type { PageGroup } from './pages'

// Counts that mean a safety condition are red; the others are informative.
const urgentCounts: Page[] = ['live', 'alerts']

export const Sidebar = memo(function Sidebar({ user, page, open, counts, navigate, logout }: {
  user: User
  page: Page
  open: boolean
  counts: Partial<Record<Page, number>>
  navigate: (page: Page) => void
  logout: () => void
}) {
  const pages: Page[] = ['dashboard', 'live', 'messages', 'alerts', 'voice', 'notices', 'devices', ...(user.role === 'Admin' ? ['users' as const] : []), 'activity']
  const groups = (['Monitoreo', 'Gestión'] as PageGroup[]).map(group => ({ group, pages: pages.filter(key => pageInfo[key].group === group) }))
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <Brand compact />
      <nav aria-label="Navegación principal">
        {groups.map(({ group, pages: items }) => (
          <div className="nav-group" key={group}>
            <span className="sidebar-label" aria-hidden="true">{group}</span>
            {items.map(key => <NavItem key={key} page={key} active={page === key} count={counts[key]} navigate={navigate} />)}
          </div>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <NavItem page="settings" active={page === 'settings'} navigate={navigate} />
        <div className="sidebar-user">
          <span className="avatar">{initials(user.name)}</span>
          <div><strong>{user.name}</strong><small>{roleName[user.role]}</small></div>
          <Tooltip text="Cerrar sesión">
            <button className="icon-button" aria-label="Cerrar sesión" onClick={logout}><LogOut size={18} /></button>
          </Tooltip>
        </div>
      </div>
    </aside>
  )
})

function NavItem({ page, active, count, navigate }: { page: Page; active: boolean; count?: number; navigate: (page: Page) => void }) {
  const { icon: Icon, navigation } = pageInfo[page]
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={() => navigate(page)} aria-current={active ? 'page' : undefined}>
      <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
      <span>{navigation}</span>
      {!!count && <span className={`nav-count mono ${urgentCounts.includes(page) ? 'danger' : ''}`}>{count}</span>}
    </button>
  )
}
