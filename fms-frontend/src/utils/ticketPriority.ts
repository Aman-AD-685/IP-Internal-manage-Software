/** Ticket priority options (Red / Yellow / Green) — no Critical or Urgent. */
export const TICKET_PRIORITY_OPTIONS = [
  { value: 'high', label: 'Red' },
  { value: 'medium', label: 'Yellow' },
  { value: 'low', label: 'Green' },
] as const

export type TicketPriorityValue = (typeof TICKET_PRIORITY_OPTIONS)[number]['value']

/** Legacy DB values still display as Red. */
export function formatPriorityLabel(priority: string | null | undefined): string {
  const p = (priority || '').toLowerCase()
  if (p === 'high' || p === 'critical' || p === 'urgent') return 'Red'
  if (p === 'medium') return 'Yellow'
  if (p === 'low') return 'Green'
  return priority ? String(priority) : '—'
}

export function getPriorityTagColor(priority: string | null | undefined): string {
  const p = (priority || '').toLowerCase()
  if (p === 'high' || p === 'critical' || p === 'urgent') return 'red'
  if (p === 'medium') return 'gold'
  if (p === 'low') return 'green'
  return 'default'
}

/** CSS color for reference numbers and other inline priority emphasis. */
export function getPriorityTextColor(priority: string | null | undefined): string | undefined {
  const p = (priority || '').toLowerCase()
  if (p === 'high' || p === 'critical' || p === 'urgent') return '#cf1322'
  if (p === 'medium') return '#d48806'
  if (p === 'low') return '#389e0d'
  return undefined
}

export function hasPriorityColor(priority: string | null | undefined): boolean {
  return getPriorityTextColor(priority) !== undefined
}

export function normalizePriorityValue(
  priority: string | null | undefined,
): TicketPriorityValue {
  const p = (priority || '').toLowerCase()
  if (p === 'high' || p === 'critical' || p === 'urgent') return 'high'
  if (p === 'low') return 'low'
  return 'medium'
}
