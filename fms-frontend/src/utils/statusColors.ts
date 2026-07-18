/**
 * Shared Ant Design Tag colours for ticket / stage / task / approval statuses.
 * Keep one map so list, drawer, dashboard, and task pages stay consistent.
 */

const STATUS_TAG_COLORS: Record<string, string> = {
  // Stage / workflow (Chores & Bugs, Feature, Staging, Register)
  pending: 'orange',
  completed: 'green',
  staging: 'blue',
  hold: 'gold',
  na: 'default',
  rejected: 'red',
  unapproved: 'orange',
  approved: 'green',

  // Ticket lifecycle status
  open: 'blue',
  in_progress: 'blue',
  resolved: 'green',
  closed: 'default',
  cancelled: 'default',
  on_hold: 'gold',

  // Common aliases
  yes: 'green',
  no: 'red',
}

/** Ant Design Tag `color` for any ticket / stage / task / approval status. */
export function getStatusTagColor(status: string | null | undefined): string {
  const key = String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (!key || key === '-' || key === '—') return 'default'
  return STATUS_TAG_COLORS[key] ?? 'default'
}
