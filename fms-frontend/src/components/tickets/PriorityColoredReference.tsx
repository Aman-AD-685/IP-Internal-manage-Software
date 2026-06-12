import { getPriorityTextColor } from '../../utils/ticketPriority'

interface PriorityColoredReferenceProps {
  referenceNo?: string | null
  priority?: string | null
  strong?: boolean
}

export function PriorityColoredReference({
  referenceNo,
  priority,
  strong = true,
}: PriorityColoredReferenceProps) {
  const text = referenceNo?.trim() || '-'
  const color = getPriorityTextColor(priority)
  if (!color || text === '-') {
    return <span>{text}</span>
  }
  return (
    <span style={{ color, fontWeight: strong ? 600 : undefined }}>{text}</span>
  )
}
