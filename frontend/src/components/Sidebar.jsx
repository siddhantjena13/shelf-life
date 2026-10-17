import { Apple, Bell, Camera, LayoutDashboard, Package, Settings, Thermometer } from 'lucide-react'

const NAV = [
  { label: 'Dashboard', Icon: LayoutDashboard, page: 'dashboard' },
  { label: 'Inventory', Icon: Package, page: 'inventory' },
  { label: 'Sensors', Icon: Thermometer, page: 'sensors' },
  { label: 'Alerts', Icon: Bell, page: 'alerts' },
  { label: 'Food profiles', Icon: Apple },
  { label: 'Settings', Icon: Settings },
]

export default function Sidebar({ page, onNavigate, inventoryCount, onLog }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <Thermometer size={16} />
        </span>
        ShelfLife
      </div>
      <nav>
        {NAV.map(({ label, Icon, page: target }) => {
          const active = target === page
          return (
            <button
              key={label}
              className={`nav-item ${active ? 'active' : ''}`}
              aria-current={active ? 'page' : undefined}
              disabled={!target}
              title={target ? undefined : 'Coming soon'}
              onClick={() => target && onNavigate(target)}
            >
              <Icon size={18} strokeWidth={1.6} />
              {label}
              {target === 'inventory' && inventoryCount > 0 && <span className="nav-count">{inventoryCount}</span>}
            </button>
          )
        })}
      </nav>
      <button className="sidebar-log" onClick={onLog}>
        <Camera size={18} />
        Log food
      </button>
    </aside>
  )
}

const MOBILE_TABS = NAV.filter((n) => n.page)

export function MobileNav({ page, onNavigate, onLog }) {
  const tab = ({ label, Icon, page: target }) => (
    <button
      key={target}
      className={page === target ? 'active' : ''}
      aria-current={page === target ? 'page' : undefined}
      onClick={() => onNavigate(target)}
    >
      <Icon size={20} strokeWidth={1.7} />
      {label}
    </button>
  )
  return (
    <nav className="mobile-nav" aria-label="Main">
      {MOBILE_TABS.slice(0, 2).map(tab)}
      <button className="mobile-fab" onClick={onLog} aria-label="Log food">
        <Camera size={24} />
      </button>
      {MOBILE_TABS.slice(2).map(tab)}
    </nav>
  )
}
