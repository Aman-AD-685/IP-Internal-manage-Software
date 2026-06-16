import { ROUTES } from './constants'

const warmed = new Set<string>()

/** Preload lazy route JS chunks before navigation (sidebar hover / idle warm). */
export function prefetchRouteChunk(routeKey: string): void {
  const path = (routeKey.split('?')[0] || '').replace(/\/+$/, '') || '/'
  if (!path || warmed.has(path)) return
  warmed.add(path)

  const run = (loader: () => Promise<unknown>) => {
    void loader().catch(() => {
      warmed.delete(path)
    })
  }

  if (path === ROUTES.DASHBOARD) {
    run(() => import('../pages/Dashboard'))
    return
  }
  if (path === ROUTES.DASHBOARD_KPI || path === ROUTES.SUCCESS_DASHBOARD) {
    run(() => import('../pages/Dashboard/DashboardKPIPage'))
    return
  }
  if (path === ROUTES.SUPPORT_DASHBOARD) {
    run(() => import('../pages/Support/SupportDashboard'))
    return
  }
  if (path === ROUTES.TICKETS) {
    run(() => import('../pages/Tickets/TicketList'))
    return
  }
  if (path === ROUTES.STAGING) {
    run(() => import('../pages/Staging/StagingList'))
    return
  }
  if (path === ROUTES.CHECKLIST) {
    run(() => import('../pages/Task/ChecklistPage'))
    return
  }
  if (path === ROUTES.DELEGATION) {
    run(() => import('../pages/Task/DelegationPage'))
    return
  }
  if (path === ROUTES.SUCCESS_PERFORMANCE) {
    run(() => import('../pages/Success/PerformanceMonitoringPage'))
    return
  }
  if (path === ROUTES.SUCCESS_COMP_PERFORM) {
    run(() => import('../pages/Success/CompPerformPage'))
    return
  }
  if (path === ROUTES.SU_DASH) {
    run(() => import('../pages/Success/DashboardPage'))
    return
  }
  if (path === ROUTES.USERS) {
    run(() => import('../pages/Users/UserList'))
    return
  }
  if (path === ROUTES.SETTINGS) {
    run(() => import('../pages/Settings/SettingsPage'))
    return
  }
  if (path === ROUTES.LEADS || path === ROUTES.LEADS_CLOSED) {
    run(() => import('../pages/Leads/LeadListPage'))
    return
  }
  if (path === ROUTES.ONBOARDING_PAYMENT_STATUS) {
    run(() => import('../pages/Onboarding/PaymentStatusPage'))
    return
  }
  if (path === ROUTES.CLIENT_PAYMENT || path.startsWith(ROUTES.CLIENT_PAYMENT)) {
    run(() => import('../pages/Onboarding/ClientPaymentPage'))
    return
  }
  if (path === ROUTES.TRAINING_CLIENT) {
    run(() => import('../pages/Training/ClientTrainingPage'))
    return
  }
  if (path.startsWith(ROUTES.DB_CLIENT)) {
    if (path === ROUTES.DB_CLIENT_DB_DASH) {
      run(() => import('../pages/DbClient/DbDashPage'))
    } else {
      run(() => import('../pages/DbClient/ClientOnbPage'))
    }
  }
}
