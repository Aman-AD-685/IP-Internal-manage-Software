export type DashboardRole = 'user' | 'admin' | 'master_admin'

export interface DashboardPermissions {
  support: boolean
  success: boolean
  clientToLead: boolean
  onboarding: boolean
  training: boolean
  clientPayment: boolean
  dbClient: boolean
  viewKpiSuccess: boolean
  manageUsers: boolean
  globalFilters: boolean
}

export interface DashboardUserContext {
  userId: string
  name: string
  role: DashboardRole
  companyIds: string[]
  permissions: DashboardPermissions
}

export interface DashboardSnapshot {
  dueToday: number
  overdue: number
  pendingApprovals: number
  kpiScore: number
  highRisk: number
}

export interface DashboardMyWork {
  checklistDueToday: number
  completedPct: number
  assignedToMe: number
  delegatedByMe: number
  supportTickets: number
}

export interface DashboardKpi {
  weekly: number
  monthly: number
  checklistPct: number
  delegationPct: number
  supportFmsPct: number
  successKpi: number | null
}

export interface DashboardSupportOperations {
  open: number
  openChores: number
  openBugs: number
  openFeatures: number
  pendingFeatureApprovals: number
  delayedResponse: number
  delayedCompletion: number
}

export interface DashboardSuccessOperations {
  active: number
  completed: number
  lowPerformance: number
}

export interface DashboardClientToLeadOperations {
  newLeads: number
  followUpDue: number
  closed: number
}

export interface DashboardOnboardingOperations {
  active: number
  stuckStage: number
  pendingSetup: number
}

export interface DashboardTrainingOperations {
  scheduled: number
  pending: number
  completed: number
}

export interface DashboardClientPaymentOperations {
  pending: number
  totalPendingAmount: number
  monthlyPendingAmount: number
  quarterlyPendingAmount: number
  ageingRisk: number
  completedRegister: number
}

export interface DashboardDbClientOperations {
  active: number
  inactive: number
  missingFollowUp: number
}

export interface DashboardOperations {
  support: DashboardSupportOperations | null
  success: DashboardSuccessOperations | null
  clientToLead: DashboardClientToLeadOperations | null
  onboarding: DashboardOnboardingOperations | null
  training: DashboardTrainingOperations | null
  clientPayment: DashboardClientPaymentOperations | null
  dbClient: DashboardDbClientOperations | null
}

export interface DashboardManagement {
  activeUsers: number
  inactiveUsers: number
  usersOverdue: number
  usersLowKpi: number
  companiesAtRisk: number
  paymentAgeingHighRisk: number
}

export interface DashboardSummaryResponse {
  user: DashboardUserContext
  snapshot: DashboardSnapshot
  myWork: DashboardMyWork
  kpi: DashboardKpi
  operations: DashboardOperations
  management: DashboardManagement | null
}

export interface DashboardSummaryFilters {
  month?: string
  week?: string
  companyId?: string
  userId?: string
  section?: string
}

export interface DashboardSupportDetailRow {
  id: string
  referenceNo: string
  title: string
  type: string
  company: string
  status: string
  reason: string
  currentStage: string
  stageStatus: string
  createdAt: string | null
}

export interface DashboardSupportDetailsResponse {
  chores: DashboardSupportDetailRow[]
  bugs: DashboardSupportDetailRow[]
  features: DashboardSupportDetailRow[]
  pendingFeatureApprovals: DashboardSupportDetailRow[]
  responseDelay: DashboardSupportDetailRow[]
  completionDelay: DashboardSupportDetailRow[]
}

export interface DashboardOperationDetailRow {
  id: string
  referenceNo: string
  title: string
  type: string
  company: string
  status: string
  reason: string
  response: string
  contact: string
  totalCompletionPct: number | null
  currentStage: string
  targetUrl: string | null
  extra?: Record<string, unknown>
}

export interface DashboardOperationDetailsResponse {
  section: string
  title: string
  rows: DashboardOperationDetailRow[]
}
