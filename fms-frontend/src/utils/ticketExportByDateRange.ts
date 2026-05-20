import { ticketsApi } from '../api/tickets'
import type { Ticket } from '../api/tickets'

type ListParams = NonNullable<Parameters<typeof ticketsApi.list>[0]>

function unwrapTicketList(response: unknown): { rows: Ticket[]; total: number } {
  if (!response || typeof response !== 'object') return { rows: [], total: 0 }
  const r = response as Record<string, unknown>
  if (Array.isArray(r.data)) {
    const rows = r.data as Ticket[]
    return { rows, total: typeof r.total === 'number' ? r.total : rows.length }
  }
  if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) {
    const inner = r.data as Record<string, unknown>
    if (Array.isArray(inner.data)) {
      const rows = inner.data as Ticket[]
      return { rows, total: typeof inner.total === 'number' ? inner.total : rows.length }
    }
  }
  return { rows: [], total: 0 }
}

/**
 * Paginate GET /tickets until a short page is returned.
 * Do not stop when `total` is reached — Supabase/axios often omits or underestimates count.
 */
export async function fetchAllTicketsPages(baseParams: ListParams): Promise<Ticket[]> {
  const all: Ticket[] = []
  let page = 1
  const pageSize = 200
  for (;;) {
    const response = await ticketsApi.list({
      ...baseParams,
      page,
      page_size: pageSize,
      skipCache: true,
    })
    const { rows: chunk } = unwrapTicketList(response)
    all.push(...chunk)
    if (chunk.length < pageSize) break
    page += 1
    if (page > 500) break
  }
  return all
}

/** Inclusive calendar dates → ISO bounds for created_at filter. */
export function dateRangeToIsoBounds(fromDay: string, toDay: string): { date_from: string; date_to: string } {
  return {
    date_from: `${fromDay}T00:00:00.000Z`,
    date_to: `${toDay}T23:59:59.999Z`,
  }
}
