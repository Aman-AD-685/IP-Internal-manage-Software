/** Query ?open= values — open matching UI when page loads in a new tab. */
export const OPEN_ACTION = {
  SUPPORT_TICKET: 'support-ticket',
  IMPROVEMENT: 'improvement',
  IMPROVEMENT_I1: 'improvement-i1',
  SOFT_SUGG: 'soft-sugg',
  SOFT_SUGG_DETAILS: 'soft-sugg-details',
  DELEGATION_CREATE: 'delegation-create',
  CHECKLIST_CREATE: 'checklist-create',
  LEAD_CREATE: 'lead-create',
  CLIENT_ONB_CREATE: 'client-onb-create',
} as const

export type OpenAction = (typeof OPEN_ACTION)[keyof typeof OPEN_ACTION]

/** Build same-page or cross-route URL that auto-opens an action after load. */
export function buildOpenActionUrl(
  pathname: string,
  search: string,
  action: OpenAction,
  extra?: Record<string, string>,
): string {
  const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  sp.set('open', action)
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) sp.set(k, v)
    }
  }
  const q = sp.toString()
  return q ? `${pathname}?${q}` : pathname
}
