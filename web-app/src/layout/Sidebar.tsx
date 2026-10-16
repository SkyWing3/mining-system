import { LogOut } from 'lucide-react'
import { Brand } from '../components/ui/Brand'
import { Tooltip } from '../components/ui/controls'
import type { Page, User } from '../types/domain'
import { initials, roleName } from '../utils/format'
import { pageInfo } from './pages'

export function Sidebar({ user, page, open, counts, navigate, logout }: {
  user: User
  page: Page
  open: boolean
  counts: Partial<Record<Page, number>>
  navigate: (page: Page) => void
  logout: () => void
}) {
  const pages: Page[] = ['dashboard', 'live', 'messages', 'alerts', 'analytics', 'voice', 'notices', 'devices', ...(user.role === 'Admin' ? ['users' as const] : []), 'activity']
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <Brand compact />
      <div className="sidebar-label">CENTRAL DE OPERACIONES</div>
      <nav aria-label="Navegación principal">
        {pages.map(key => <NavItem key={key} page={key} active={page === key} count={counts[key]} navigate={navigate} />)}
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
}

function NavItem({ page, active, count, navigate }: { page: Page; active: boolean; count?: number; navigate: (page: Page) => void }) {
  const { icon: Icon, navigation } = pageInfo[page]
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={() => navigate(page)} aria-current={active ? 'page' : undefined}>
      <Icon size={19} strokeWidth={1.7} />
      <span>{navigation}</span>
      {!!count && <span className={`nav-count ${page === 'live' ? 'danger' : ''}`}>{count}</span>}
    </button>
  )
}

