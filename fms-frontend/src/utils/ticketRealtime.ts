import {
  invalidateAfterStage2Remark,
  invalidateAfterTicketMutation,
  sessionApiCacheRemove,
} from './sessionApiCache'
import { notifyStage2RemarkAdded } from './stage2RemarkEvents'

/** Fired after a `ticket_changed` WebSocket event — lists/drawers refetch. */
export const TICKET_CHANGED_EVENT = 'fms:ticket-changed'

export type TicketChangedDetail = {
  ticket_id: string
  reason: string
}

export function applyTicketChangedFromWs(data: unknown): void {
  if (!data || typeof data !== 'object') return
  const d = data as Record<string, unknown>
  const ticketId = typeof d.ticket_id === 'string' ? d.ticket_id : ''
  if (!ticketId) return
  const reason = typeof d.reason === 'string' ? d.reason : 'update'

  invalidateAfterTicketMutation(ticketId)
  sessionApiCacheRemove('support-dashboard:stats')
  if (reason === 'remark') {
    invalidateAfterStage2Remark()
    notifyStage2RemarkAdded()
  }

  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<TicketChangedDetail>(TICKET_CHANGED_EVENT, {
      detail: { ticket_id: ticketId, reason },
    }),
  )
}
