import { CircleCheck, OctagonAlert, TriangleAlert } from 'lucide-react'

const LEVELS = {
  good: { Icon: CircleCheck, color: 'var(--status-good)' },
  warning: { Icon: TriangleAlert, color: 'var(--status-warning)' },
  critical: { Icon: OctagonAlert, color: 'var(--status-critical)' },
}

export function StatusIcon({ level, size = 16 }) {
  const { Icon, color } = LEVELS[level]
  return <Icon size={size} color={color} aria-hidden="true" />
}

export default function StatusBadge({ level, label }) {
  return (
    <span className="status">
      <StatusIcon level={level} />
      {label}
    </span>
  )
}
