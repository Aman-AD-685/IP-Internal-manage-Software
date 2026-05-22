import { ROUTES } from './constants'
import { API_ENDPOINTS } from './constants'
import { ticketsApi } from '../api/tickets'
import { checklistApi } from '../api/checklist'
import { delegationApi } from '../api/delegation'
import { onboardingApi } from '../api/onboarding'
import { leadsApi } from '../api/leads'
import { trainingApi } from '../api/training'
import { usersApi } from '../api/users'
import { dbClientOnbApi } from '../api/dbClientOnb'
import { dashboardApi } from '../api/dashboard'
import { prefetchDashboardKpiPerson, DASHBOARD_KPI_NAMES, MONTHS } from '../api/dashboardKpi'
import { getDefaultPreviousWeekFilter } from '../pages/Dashboard/kpiWeekUtils'
import { supportDashboardApi } from '../api/supportDashboard'
import { apiClient } from '../api/axios'
import { runPrefetchLimited } from './prefetchConcurrency'

const inFlight = new Set<string>()
const prefetched = new Set<string>()
let idleBatchStarted = false
let refreshTimer: number | null = null
let trackedRouteKeys: string[] = []
const TEN_MIN_MS = 20 * 60 * 1000
/** Only warm a few routes right after login — avoids 10+ parallel API calls. */
/** Disabled — bootstrap on dashboard mount is enough; avoids competing with first paint. */
const IMMEDIATE_WARM_COUNT = 0
const IMMEDIATE_STEP_MS = 500
const REFRESH_BATCH_SIZE = 2
const IDLE_STAGGER_MS = 400
let refreshCursor = 0

function fire(key: string, run: () => Promise<unknown>) {
  if (inFlight.has(key)) return
  inFlight.add(key)
  runPrefetchLimited(() => run().finally(() => inFlight.delete(key)))
}

export function prefetchRouteData(routeKey: string): void {
  const [path] = routeKey.split('?')
  const q = routeKey.includes('?') ? routeKey.slice(routeKey.indexOf('?') + 1) : ''

  if (path === ROUTES.DASHBOARD) {
    fire('prefetch:dashboard', async () => {
      await dashboardApi.getBootstrap()
    })
    return
  }

  if (path === ROUTES.DASHBOARD_KPI) {
    const personParam = new URLSearchParams(q).get('person')?.trim()
    const match = personParam
      ? DASHBOARD_KPI_NAMES.find((n) => n.toLowerCase() === personParam.toLowerCase())
      : null
    const prev = getDefaultPreviousWeekFilter()
    const filters = {
      month: MONTHS[prev.monthIndex] ?? MONTHS[0],
      year: prev.year,
      week: `week ${prev.week}`,
    }
    if (match) {
      fire(`prefetch:kpi:${match}`, () => {
        prefetchDashboardKpiPerson(match, filters)
      })
    }
    return
  }

  if (path === ROUTES.SUCCESS_DASHBOARD) {
    return
  }

  if (path === ROUTES.SUPPORT_DASHBOARD) {
    fire('prefetch:support-dashboard', async () => {
      await Promise.all([
        supportDashboardApi.getStats(),
        supportDashboardApi.getFeatureTickets('all'),
      ])
    })
    return
  }

  if (path === ROUTES.TICKETS) {
    fire(`prefetch:${routeKey}`, async () => {
      const common = { page: 1, page_size: 15 as const, sort_by: 'created_at', sort_order: 'desc' as const, skipCache: true }
      if (q.includes('section=chores-bugs')) {
        await ticketsApi.list({ ...common, section: 'chores-bugs' })
      } else if (q.includes('section=completed-chores-bugs')) {
        await ticketsApi.list({ ...common, section: 'completed-chores-bugs' })
      } else if (q.includes('section=rejected-tickets')) {
        await ticketsApi.list({ ...common, section: 'rejected-tickets' })
      } else if (q.includes('section=completed-feature')) {
        await ticketsApi.list({ ...common, section: 'completed-feature' })
      } else if (q.includes('type=feature') && q.includes('view=approval')) {
        await ticketsApi.list({ ...common, section: 'approval-status', approval_filter: 'pending' })
      } else if (q.includes('type=feature')) {
        await ticketsApi.list({ ...common, type: 'feature' })
      } else {
        await ticketsApi.list(common)
      }
    })
    return
  }

  if (path === ROUTES.STAGING) {
    fire('prefetch:staging', () =>
      ticketsApi.list({ section: 'staging', page: 1, page_size: 15, sort_by: 'created_at', sort_order: 'desc', skipCache: true }),
    )
    return
  }

  if (path === ROUTES.CHECKLIST) {
    fire('prefetch:checklist', async () => {
      await Promise.all([
        checklistApi.getDepartments(),
        checklistApi.getUsers(),
        checklistApi.getTasks(),
        checklistApi.getOccurrences('today'),
      ])
    })
    return
  }

  if (path === ROUTES.DELEGATION) {
    fire('prefetch:delegation', async () => {
      await Promise.all([
        delegationApi.getUsers(),
        delegationApi.getTasks({ status: 'pending' }),
      ])
    })
    return
  }

  if (path === ROUTES.LEADS) {
    fire(`prefetch:${routeKey}`, async () => {
      const isClosed = routeKey.includes('status=Closed')
      await Promise.all([
        leadsApi.getStages(),
        leadsApi.getUsers(),
        leadsApi.list({ status: isClosed ? 'Closed' : 'Open' }),
      ])
    })
    return
  }

  if (path === ROUTES.ONBOARDING_PAYMENT_STATUS) {
    fire('prefetch:onboarding-payment-status', () => onboardingApi.listPaymentStatus())
    return
  }

  if (path === ROUTES.CLIENT_PAYMENT) {
    fire('prefetch:client-payment-open', async () => {
      await apiClient.get<{ items: unknown[] }>(API_ENDPOINTS.CLIENT_PAYMENT.LIST_OPEN)
    })
    return
  }

  if (path === ROUTES.CLIENT_PAYMENT_COMP_REGISTER) {
    fire('prefetch:client-payment-comp-register', async () => {
      await apiClient.get(API_ENDPOINTS.CLIENT_PAYMENT.LIST, {
        params: { status: 'completed', section: 'Comp-Register', page: 1, page_size: 10 },
      })
    })
    return
  }

  if (
    path === ROUTES.CLIENT_PAYMENT_Q_COMP ||
    path === ROUTES.CLIENT_PAYMENT_M_COMP ||
    path === ROUTES.CLIENT_PAYMENT_HF_COMP
  ) {
    fire('prefetch:client-payment-completed-legacy', async () => {
      await apiClient.get(API_ENDPOINTS.CLIENT_PAYMENT.LIST, {
        params: { status: 'completed', section: 'Comp-Register', page: 1, page_size: 10 },
      })
    })
    return
  }

  if (path === ROUTES.CLIENT_PAYMENT_PAYMENT_AGEING) {
    fire('prefetch:client-payment-ageing', async () => {
      await apiClient.get(API_ENDPOINTS.CLIENT_PAYMENT.PAYMENT_AGEING_REPORT)
    })
    return
  }

  if (path === ROUTES.CLIENT_PAYMENT_PENDING_DETAILS) {
    fire('prefetch:client-payment-pending', async () => {
      await apiClient.get<{ items: unknown[] }>(API_ENDPOINTS.CLIENT_PAYMENT.LIST_OPEN)
    })
    return
  }

  if (path === ROUTES.TRAINING_CLIENT) {
    fire('prefetch:training-client', async () => {
      await Promise.all([trainingApi.listClients(), trainingApi.getStagesConfig()])
    })
    return
  }

  if (path === ROUTES.DB_CLIENT_CLIENT_ONB || path === ROUTES.DB_CLIENT_CLIENT_ONB_INACTIVE) {
    fire('prefetch:db-client-onb', () => dbClientOnbApi.list())
    return
  }

  if (path === ROUTES.USERS) {
    fire('prefetch:users', async () => {
      await Promise.all([usersApi.list({ page: 1, limit: 15 }), usersApi.listRoles()])
    })
    return
  }

  if (path === ROUTES.SUCCESS_PERFORMANCE || path === ROUTES.SUCCESS_COMP_PERFORM || path === ROUTES.SU_DASH) {
    fire(`prefetch:${path}`, async () => {
      await Promise.all([
        dashboardApi.getSuccessKpiTillDate(),
        dashboardApi.getSuccessPerformanceList('in_progress'),
        dashboardApi.getSuccessPerformanceList('completed'),
      ])
    })
  }
}

function scheduleIdle(task: () => void) {
  if (typeof window === 'undefined') return
  const w = window as Window & {
    requestIdleCallback?: (cb: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void, opts?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(() => task(), { timeout: 1500 })
    return
  }
  window.setTimeout(task, 300)
}

function runImmediateWarmup(routeKeys: string[]) {
  const priority = [
    ROUTES.DASHBOARD,
    ROUTES.SUPPORT_DASHBOARD,
    ROUTES.TICKETS,
    ROUTES.STAGING,
    ROUTES.CLIENT_PAYMENT,
    ROUTES.ONBOARDING_PAYMENT_STATUS,
    ROUTES.TRAINING_CLIENT,
  ]
  const sorted = [...routeKeys].sort((a, b) => {
    const ia = priority.findIndex((p) => a.startsWith(p))
    const ib = priority.findIndex((p) => b.startsWith(p))
    const sa = ia === -1 ? 999 : ia
    const sb = ib === -1 ? 999 : ib
    return sa - sb
  })
  sorted.slice(0, IMMEDIATE_WARM_COUNT).forEach((key, idx) => {
    window.setTimeout(() => {
      if (document.visibilityState === 'hidden') return
      prefetchRouteData(key)
    }, idx * IMMEDIATE_STEP_MS)
  })
}

export function startIdleRoutePrefetch(routeKeys: string[]): void {
  if (typeof window === 'undefined') return
  trackedRouteKeys = Array.from(new Set(routeKeys.filter(Boolean)))
  if (!idleBatchStarted) idleBatchStarted = true

  const unique = trackedRouteKeys.filter((k) => {
    if (!k || prefetched.has(k)) return false
    prefetched.add(k)
    return true
  })

  // Warm top routes immediately after login for fast first navigation.
  runImmediateWarmup(unique)

  unique.forEach((key, index) => {
    scheduleIdle(() => {
      window.setTimeout(() => {
        if (document.visibilityState === 'hidden') return
        prefetchRouteData(key)
      }, index * IDLE_STAGGER_MS)
    })
  })

  if (refreshTimer != null) return
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'hidden') return
    if (trackedRouteKeys.length === 0) return
    const batch: string[] = []
    for (let i = 0; i < Math.min(REFRESH_BATCH_SIZE, trackedRouteKeys.length); i++) {
      batch.push(trackedRouteKeys[(refreshCursor + i) % trackedRouteKeys.length])
    }
    refreshCursor = (refreshCursor + batch.length) % trackedRouteKeys.length
    batch.forEach((key, index) => {
      window.setTimeout(() => {
        prefetchRouteData(key)
      }, index * 120)
    })
  }, TEN_MIN_MS)
}
