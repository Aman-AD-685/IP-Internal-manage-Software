import { useEffect, useRef } from 'react'
import {
  TICKET_CHANGED_EVENT,
  type TicketChangedDetail,
} from '../utils/ticketRealtime'

/** Refetch open ticket UI when another client mutates the same ticket over /ws. */
export function useTicketRealtimeRefresh(
  enabled: boolean,
  ticketId: string | null | undefined,
  onRefresh: (detail: TicketChangedDetail) => void,
): void {
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  useEffect(() => {
    if (!enabled || !ticketId) return
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<TicketChangedDetail>).detail
      if (!detail?.ticket_id || detail.ticket_id !== ticketId) return
      onRefreshRef.current(detail)
    }
    window.addEventListener(TICKET_CHANGED_EVENT, handler)
    return () => window.removeEventListener(TICKET_CHANGED_EVENT, handler)
  }, [enabled, ticketId])
}
