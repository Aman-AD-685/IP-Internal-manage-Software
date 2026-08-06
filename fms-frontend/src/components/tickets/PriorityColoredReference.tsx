import { getPriorityTextColor } from '../../utils/ticketPriority'

interface PriorityColoredReferenceProps {
  referenceNo?: string | null
  priority?: string | null
  strong?: boolean
  /** When true: list shows (C.R); detail shows "Claude Review" */
  claudeReviewed?: boolean
  claudeReviewDisplay?: 'badge' | 'label'
}

export function PriorityColoredReference({
  referenceNo,
  priority,
  strong = true,
  claudeReviewed = false,
  claudeReviewDisplay = 'badge',
}: PriorityColoredReferenceProps) {
  const text = referenceNo?.trim() || '-'
  const color = getPriorityTextColor(priority)
  const refEl =
    !color || text === '-' ? (
      <span>{text}</span>
    ) : (
      <span style={{ color, fontWeight: strong ? 600 : undefined }}>{text}</span>
    )

  if (!claudeReviewed || text === '-') {
    return refEl
  }

  const mark =
    claudeReviewDisplay === 'label' ? (
      <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 500, color: '#595959' }}>
        Claude Review
      </span>
    ) : (
      <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 500, color: '#8c8c8c' }}>(C.R)</span>
    )

  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      {refEl}
      {mark}
    </span>
  )
}
