import { Apple, Bell, LayoutDashboard, Package, Settings, Thermometer } from 'lucide-react'

const NAV = [
  { label: 'Dashboard', Icon: LayoutDashboard, active: true },
  { label: 'Inventory', Icon: Package },
  { label: 'Sensors', Icon: Thermometer },
  { label: 'Alerts', Icon: Bell },
  { label: 'Food profiles', Icon: Apple },
  { label: 'Settings', Icon: Settings },
]

export default function Sidebar({ activePage, onNavigate }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <Thermometer size={16} />
        </span>
        ShelfLife
      </div>
      <nav>
        {NAV.map(({ label, Icon }) => (
          <button
            key={label}
            className={`nav-item ${activePage === label ? 'active' : ''}`}
            aria-current={activePage === label ? 'page' : undefined}
            disabled={!['Dashboard', 'Inventory', 'Sensors', 'Alerts'].includes(label)}
            title={['Dashboard', 'Inventory', 'Sensors', 'Alerts'].includes(label) ? undefined : 'Coming soon'}
            onClick={() => onNavigate(label)}
          >
            <Icon size={18} strokeWidth={1.6} />
            {label}
          </button>
        ))}
      </nav>
    </aside>
  )
}
