export const APP_NAME = 'IP Internal Management Software'

export const ROLES = {
  USER: 'user',
  APPROVER: 'approver',
  ADMIN: 'admin',
  MASTER_ADMIN: 'master_admin',
} as const

export type RoleType = (typeof ROLES)[keyof typeof ROLES]

/** Display labels for Role column and dropdowns */
export const ROLE_DISPLAY_NAMES: Record<string, string> = {
  master_admin: 'Master Admin',
  admin: 'Admin',
  approver: 'Approver',
  user: 'User',
}

/** Section keys and labels for Edit User permissions (View / Edit checkboxes). Add new app sections here and in backend SECTION_KEYS. */
/** Keep in sync with backend SECTION_LABELS in app/main.py (_SECTION_LABELS_BASE). */
export const SECTION_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  dashboard_kpi: 'Dashboard - KPI',
  improvement: 'Improvement',
  improvement_i1: 'I - 1',
  soft_sugg: 'IP Suggestion',
  soft_sugg_details: 'IP Details',
  support_dashboard: 'Support Dashboard',
  all_tickets: 'All Tickets',
  chores_bugs: 'Chores & Bugs',
  staging: 'Staging',
  feature: 'Feature',
  approval_status: 'Approval Status',
  completed_chores_bugs: 'Completed Chores & Bugs',
  rejected_tickets: 'Rejected Tickets',
  completed_feature: 'Completed Feature',
  solution: 'Solution',
  task: 'Task',
  success_performance: 'Performance Monitoring',
  success_comp_perform: 'Comp- Perform',
  client_to_lead: 'Client to Lead',
  leads: 'Lead',
  onboarding: 'Onboarding',
  onboarding_payment_status: 'Payment Status',
  client_payment: 'Client Payment',
  training: 'Training',
  db_client: 'DB Client',
  settings: 'Settings',
  users: 'Users',
}

/**
 * Ordered list for Edit User → Section permissions. Must match backend `SECTION_KEYS` in `main.py`.
 * New sections appear here unchecked until a Master Admin grants access.
 */
export const PERMISSION_SECTION_KEYS: readonly string[] = [
  'dashboard',
  'dashboard_kpi',
  'improvement',
  'improvement_i1',
  'soft_sugg',
  'soft_sugg_details',
  'support_dashboard',
  'all_tickets',
  'chores_bugs',
  'staging',
  'feature',
  'approval_status',
  'completed_chores_bugs',
  'rejected_tickets',
  'completed_feature',
  'solution',
  'task',
  'success_performance',
  'success_comp_perform',
  'client_to_lead',
  'leads',
  'onboarding',
  'onboarding_payment_status',
  'client_payment',
  'training',
  'db_client',
  'settings',
  'users',
]

/** Any of these grants access to `/tickets` and ticket detail (query selects subsection). */
export const TICKET_ROUTE_SECTION_KEYS: readonly string[] = [
  'all_tickets',
  'chores_bugs',
  'staging',
  'feature',
  'approval_status',
  'completed_chores_bugs',
  'rejected_tickets',
  'completed_feature',
]

export const ROUTES = {
  REGISTER: '/register',
  LOGIN: '/login',
  /** Supabase password recovery redirect (hash with access_token) */
  RESET_PASSWORD: '/reset-password',
  OTP: '/otp',
  CONFIRMATION_SUCCESS: '/confirmation-success',
  DASHBOARD: '/dashboard',
  DASHBOARD_KPI: '/dashboard/kpi',
  SUPPORT_DASHBOARD: '/support/dashboard',
  SU_DASH: '/success/su-dash',
  TICKETS: '/tickets',
  TICKET_DETAIL: '/tickets/:id',
  SOLUTIONS: '/solutions/:ticketId',
  STAGING: '/staging',
  /** Task module (separate from Support) */
  CHECKLIST: '/task/checklist',
  DELEGATION: '/task/delegation',
  /** Success module */
  SUCCESS_DASHBOARD: '/success/dashboard',
  SUCCESS_PERFORMANCE: '/success/performance',
  SUCCESS_COMP_PERFORM: '/success/comp-perform',
  /** Client to Lead module */
  CLIENT_TO_LEAD: '/client-to-lead',
  LEADS: '/client-to-lead/leads',
  LEADS_CLOSED: '/client-to-lead/leads?status=Closed',
  LEAD_DETAIL: '/client-to-lead/leads/:id',
  LEADS_IMPORT: '/client-to-lead/import',
  /** Onboarding module */
  ONBOARDING: '/onboarding',
  ONBOARDING_PAYMENT_STATUS: '/onboarding/payment-status',
  CLIENT_PAYMENT: '/onboarding/client-payment',
  /** Completed Q / M / HY (merged register; optional ?genre=) */
  CLIENT_PAYMENT_COMP_REGISTER: '/onboarding/client-payment/completed/Comp-Register',
  /** Legacy URLs — App redirects to Comp-Register with genre */
  CLIENT_PAYMENT_Q_COMP: '/onboarding/client-payment/completed/Q-Comp',
  CLIENT_PAYMENT_M_COMP: '/onboarding/client-payment/completed/M-Comp',
  CLIENT_PAYMENT_HF_COMP: '/onboarding/client-payment/completed/HF-Comp',
  /** Payment Ageing Report (grid + summary; data from API) */
  CLIENT_PAYMENT_PAYMENT_AGEING: '/onboarding/client-payment/payment-ageing',
  /** Pending payment list (unpaid invoices with overdue) */
  CLIENT_PAYMENT_PENDING_DETAILS: '/onboarding/client-payment/pending-payment-details',
  /** Training module */
  TRAINING: '/training',
  TRAINING_CLIENT: '/training/client-training',
  /** DB Client module */
  DB_CLIENT_CLIENT_ONB: '/db-client/client-onb',
  DB_CLIENT_CLIENT_ONB_INACTIVE: '/db-client/client-onb/inactive',
  DB_CLIENT_DB_DASH: '/db-client/db-dash',
  USERS: '/users',
  SETTINGS: '/settings',
  /** Shown when user opens a URL for a section they are not allowed to view */
  ACCESS_DENIED: '/access-denied',
} as const

/** PENDING PAYMENT DETAILS route + menu: only these sign-in emails may open it. */
export const PENDING_PAYMENT_DETAILS_ALLOWED_EMAILS: readonly string[] = [
  'ayush@industryprime.com',
  'ea@industryprime.com',
  'ad@ip.com',
]

export function canViewPendingPaymentDetails(email: string | null | undefined): boolean {
  const e = (email ?? '').trim().toLowerCase()
  if (!e) return false
  return PENDING_PAYMENT_DETAILS_ALLOWED_EMAILS.some((a) => a.toLowerCase() === e)
}

/** DB Client dashboard route + menu: only these sign-in emails may open it. */
export const DB_CLIENT_DB_DASH_ALLOWED_EMAILS: readonly string[] = [
  'ayush@industryprime.com',
  'ea@industryprime.com',
  'sk@industryprime.com',
  'ad@ip.com',
]

export function canViewDbClientDbDash(email: string | null | undefined): boolean {
  const e = (email ?? '').trim().toLowerCase()
  if (!e) return false
  return DB_CLIENT_DB_DASH_ALLOWED_EMAILS.some((a) => a.toLowerCase() === e)
}

export const API_ENDPOINTS = {
  AUTH: {
    REGISTER: '/auth/register',
    LOGIN: '/auth/login',
    LOGOUT: '/auth/logout',
    VERIFY_OTP: '/auth/verify-otp',
    REFRESH: '/auth/refresh',
    CURRENT_USER: '/users/me',
  },
  TICKETS: {
    LIST: '/tickets',
    DETAIL: (id: string) => `/tickets/${id}`,
    CREATE: '/tickets',
    UPDATE: (id: string) => `/tickets/${id}`,
    DELETE: (id: string) => `/tickets/${id}`,
  },
  SOLUTIONS: {
    LIST: (ticketId: string) => `/solutions/ticket/${ticketId}`,
    CREATE: '/solutions',
    UPDATE: (id: string) => `/solutions/${id}`,
  },
  STAGING: {
    LIST: '/staging/deployments',
    CREATE: '/staging/deployments',
    UPDATE: (id: string) => `/staging/deployments/${id}`,
  },
  USERS: {
    LIST: '/users',
    DETAIL: (id: string) => `/users/${id}`,
    UPDATE: (id: string) => `/users/${id}`,
  },
  ONBOARDING_PAYMENT_STATUS: {
    LIST: '/onboarding/payment-status',
    CREATE: '/onboarding/payment-status',
    PRE_ONBOARDING: (id: string) => `/onboarding/payment-status/${id}/pre-onboarding`,
    PRE_ONBOARDING_CHECKLIST: (id: string) => `/onboarding/payment-status/${id}/pre-onboarding-checklist`,
    POC_CHECKLIST: (id: string) => `/onboarding/payment-status/${id}/poc-checklist`,
    POC_DETAILS: (id: string) => `/onboarding/payment-status/${id}/poc-details`,
    DETAILS_COLLECTED_CHECKLIST: (id: string) => `/onboarding/payment-status/${id}/details-collected-checklist`,
    ITEM_CLEANING: (id: string) => `/onboarding/payment-status/${id}/item-cleaning`,
    ITEM_CLEANING_CHECKLIST: (id: string) => `/onboarding/payment-status/${id}/item-cleaning-checklist`,
    ORG_MASTER_ID: (id: string) => `/onboarding/payment-status/${id}/org-master-id`,
    ORG_MASTER_CHECKLIST: (id: string) => `/onboarding/payment-status/${id}/org-master-checklist`,
    SETUP_CHECKLIST: (id: string) => `/onboarding/payment-status/${id}/setup-checklist`,
    ITEM_STOCK_CHECKLIST: (id: string) => `/onboarding/payment-status/${id}/item-stock-checklist`,
    FINAL_SETUP: (id: string) => `/onboarding/payment-status/${id}/final-setup`,
  },
  CLIENT_PAYMENT: {
    LIST: '/onboarding/client-payment',
    LIST_OPEN: '/onboarding/client-payment?status=open',
    LIST_COMPLETED: (section: string, genre?: string) => {
      const sp = new URLSearchParams({ status: 'completed', section })
      if (genre) sp.set('genre', genre)
      return `/onboarding/client-payment?${sp.toString()}`
    },
    CREATE: '/onboarding/client-payment',
    UPDATE: (id: string) => `/onboarding/client-payment/${id}`,
    PAYMENT_AGEING_REPORT: '/onboarding/client-payment/payment-ageing-report',
    /** KPI cards + dashboard payment totals (NA rows excluded). */
    PAYMENT_SUMMARY: '/onboarding/client-payment/payment-summary',
  },
  LEADS: {
    LIST: '/leads',
    ACTIVE: '/leads/active',
    STAGES: '/leads/stages',
    USERS: '/leads/users',
    DETAIL: (id: string) => `/leads/${id}`,
    BY_REFERENCE: (ref: string) => `/leads/by-reference/${ref}`,
    STAGE: (id: string, slug: string) => `/leads/${id}/stages/${slug}`,
  },
  DB_CLIENT: {
    CLIENT_ONB_LIST: '/db-client/client-onb',
    CLIENT_ONB_STATUS_COLUMN_CHECK: '/db-client/client-onb/status-column-check',
    CLIENT_ONB_UPDATE: (id: string) => `/db-client/client-onb/${id}`,
    CLIENT_ONB_STATUS: (id: string) => `/db-client/client-onb/${id}/status`,
    CLIENT_ONB_FOLLOW_UP: (id: string) => `/db-client/client-onb/${id}/follow-up`,
  },
  TRAINING: {
    CLIENTS: '/training/clients',
    ASSIGN: (id: string) => `/training/clients/${id}/assignment`,
    USERS: '/training/users',
    DAY0: (id: string) => `/training/clients/${id}/day0-checklist`,
    STAGES_CONFIG: '/training/stages-config',
    TRAINING_STATUS: (id: string) => `/training/clients/${id}/training-status`,
    STAGE: (id: string, stageKey: string) => `/training/clients/${id}/stages/${stageKey}`,
    AVAILABLE_FOR_MANUAL: '/training/clients/available-for-manual',
    MANUAL_ADD: '/training/clients/manual',
  },
} as const

export const STORAGE_KEYS = {
  AUTH_TOKEN: 'auth_token',
  REFRESH_TOKEN: 'refresh_token',
  USER: 'user',
  OTP_EMAIL: 'otp_email',
} as const
