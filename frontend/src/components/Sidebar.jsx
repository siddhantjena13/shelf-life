import { Apple, Bell, LayoutDashboard, Package, Settings, Thermometer } from 'lucide-react'

const NAV = [
  { label: 'Dashboard', Icon: LayoutDashboard, active: true },
  { label: 'Inventory', Icon: Package },
  { label: 'Sensors', Icon: Thermometer },
  { label: 'Alerts', Icon: Bell },
  { label: 'Food profiles', Icon: Apple },
  { label: 'Settings', Icon: Settings },
]

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <Thermometer size={16} />
        </span>
        ShelfSense
      </div>
      <nav>
        {NAV.map(({ label, Icon, active }) => (
          <button
            key={label}
            className={`nav-item ${active ? 'active' : ''}`}
            aria-current={active ? 'page' : undefined}
            disabled={!active}
            title={active ? undefined : 'Coming soon'}
          >
            <Icon size={18} strokeWidth={1.6} />
            {label}
          </button>
        ))}
      </nav>
    </aside>
  )
}
