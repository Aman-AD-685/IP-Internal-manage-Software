import { apiClient } from './axios'

export const DASHBOARD_KPI_NAMES = ['Shreyasi', 'Rimpa', 'Akash', 'Adrija', 'Soumya'] as const
export type DashboardKpiPerson = (typeof DASHBOARD_KPI_NAMES)[number]

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
export const WEEKS = ['week 1', 'week 2', 'week 3', 'week 4', 'week 5'] as const
export const YEARS = ['2024', '2025', '2026', '2027'] as const

export interface DashboardKpiFilters {
  name: string
  month: string
  year: string
  week: string
}

export interface ChecklistRow {
  task_name: string
  frequency: string
  status: string
  details?: string
}

export interface DelegationRow {
  task: string
  status: string
  shifted_week?: string
  month?: string
  button_url?: string
}

export interface SupportFmsDelayItem {
  type: string
  company?: string
  requested_person?: string
  submitted_by?: string
  title?: string
  description?: string
  reference_no?: string
  delay_time?: string
  query_arrival?: string
  month?: string
  /** Akash Customer Support detail rows */
  ticket_status?: string
}

export interface SupportFmsSection {
  value: number
  target: number
  percentage?: string
  details?: SupportFmsDelayItem[]
}

export interface SuccessKpiClickEventRow {
  company?: string
  feature?: string
  clickedAt?: string
}

export interface SuccessKpiDetailLists {
  /** POC Collected: reference numbers for rows in the selected week */
  referenceNumbers?: string[]
  companies: string[]
  messageOwner?: string[]
  dates?: string[]
  responses?: string[]
  contacts?: string[]
  callPOC?: string[]
  messagePOC?: string[]
  trainingDates?: string[]
  trainingStatus?: string[]
  remarks?: string[]
  features?: (string[])[]
  followupDates?: string[]
  beforePercentages?: (number | null)[]
  afterPercentages?: (number | null)[]
  /** Training Follow-up: follow-up rows logged in selected week */
  followupRowsWeek?: number
  /** Training Follow-up: "Add follow-up" button clicks in selected week */
  clickCountWeek?: number
  /** Training Follow-up: per-click rows for the modal (selected week) */
  clickEventsWeek?: SuccessKpiClickEventRow[]
}

export interface SuccessKpiSection {
  currentValue: number
  targetValue: number
  percentage: string
  details: SuccessKpiDetailLists
}

export interface AkashKpiMetricRow {
  label: string
  value: string
}

export interface AkashKpiPillar {
  key: string
  title: string
  weight: number
  weight_percent_display: number
  score_percent: number
  metrics: AkashKpiMetricRow[]
}

export interface AkashCustomerSupportMeta {
  selectedWeekNum?: number
  dataWeekNum?: number | null
  dataMonth?: string
  dataYear?: string
  dataRangeLabel?: string
  /** Mon–Sun range for arrivals used in headline blend vs checklist week */
  selectedWeekRangeLabel?: string
  helpNote?: string
}

export interface AkashCustomerSupportBlock {
  scorePercent?: number
  /** Support health % for the same week as Month/Year/Week filters (used in headline blend) */
  scorePercentFilterWeek?: number
  totalIssues?: number
  responseDelayCount?: number
  completionDelayCount?: number
  pendingCount?: number
  responseTimeDisplay?: string
  meta?: AkashCustomerSupportMeta
  /** @deprecated use split detail arrays */
  details?: SupportFmsDelayItem[]
  detailsResponseDelay?: SupportFmsDelayItem[]
  detailsCompletionDelay?: SupportFmsDelayItem[]
  detailsPending?: SupportFmsDelayItem[]
}

export interface AkashKpiMonthlySummary {
  overall_score_percent: number
  pillars: AkashKpiPillar[]
  /** True when daily work log had rows in the selected calendar month */
  dailyLogMonthApplied?: boolean
}

export interface AkashKpiResponse {
  weights_raw: Record<string, number>
  weights_normalized_100: Record<string, number>
  weight_sum_raw: number
  overall_score_percent: number
  /** Blended headline % for the full selected calendar month (same weights as weekly) */
  overall_score_monthly_percent?: number
  pillars: AkashKpiPillar[]
  customerSupport?: AkashCustomerSupportBlock
  /** Pillar-level % for the month; used by KPI Monthly drill-down chart */
  monthly?: AkashKpiMonthlySummary
  /** True when item/video/AI weekly aggregates used the KPI daily work log for the filter week */
  dailyLogWeekApplied?: boolean
  /** Only for akash@ / aman@ — show Add KPI (daily log editor) */
  kpiDailyLogEditor?: boolean
}

/** One row from GET/PUT `/dashboard/kpi-daily-log` (spreadsheet yellow cells). */
export interface KpiDailyLogApiRow {
  work_date: string
  items_cleaned?: number | null
  errors_found?: number | null
  accuracy_pct?: number | null
  videos_created?: number | null
  video_type?: string | null
  ai_tasks_used?: number | null
  process_improved?: number | null
}

export interface AdrijaSocialKpiPayload {
  weekStart: string
  weekEnd: string
  weekLabel: string
  postWeek: number
  reelWeek: number
  linkedinWeek: number
  /** 0–100: (post + reel + linkedin) met in selected week vs 3 targets. */
  weeklyPercent?: number
  /** 0–100: share of day-slots filled in the selected calendar month (3 flags × each day). */
  monthlyPercent?: number
  postCompletionDates?: string[]
  reelCompletionDates?: string[]
  linkedinCompletionDates?: string[]
  postCompletionDetails?: Array<{ date: string; taskName: string }>
  reelCompletionDetails?: Array<{ date: string; taskName: string }>
  linkedinCompletionDetails?: Array<{ date: string; taskName: string }>
  editor: boolean
}

export interface AdrijaSocialKpiDailyRow {
  work_date: string
  dayName: string
  post: number
  reel: number
  linkedin: number
  post_task_name?: string
  reel_task_name?: string
  linkedin_task_name?: string
}

export interface SuccessKpiResponse {
  pocCollected: SuccessKpiSection
  weeklyTrainingTarget: SuccessKpiSection
  trainingFollowUp: SuccessKpiSection
  successIncrease: SuccessKpiSection
  overallPercentage: number
  meta?: {
    weekLabel?: string
    targets?: { poc: number; training: number; followup: number; increase: number }
  }
}

/** Calendar week envelope for KPI filters (merged month boundaries share one key). */
export interface KpiWeekCalendarMeta {
  mergedWeekKey?: string
  startDate?: string
  endDate?: string
  spansPreviousMonth?: boolean
  spansNextMonth?: boolean
  mergeBadge?: string
  tooltip?: string
}

export interface DashboardKpiResponse {
  success: boolean
  error?: string
  meta?: {
    applied: DashboardKpiFilters
    availableMonths: string[]
    availableWeeks: string[]
    availableYears: string[]
    maxWeekIndex?: number
    mergedWeekKey?: string
    weekCalendar?: KpiWeekCalendarMeta
  }
  checklist?: {
    rows: ChecklistRow[]
    totals?: { done: number; pending: number }
    weeklyPercentage: number
  }
  delegation?: {
    rows: DelegationRow[]
    weeklyPercentage: number
  }
  supportFMS?: {
    responseDelay: SupportFmsSection
    completionDelay: SupportFmsSection
    pendingChores: SupportFmsSection
    weeklyPercentage?: number
  }
  successKpi?: SuccessKpiResponse
  akashKpi?: AkashKpiResponse | null
  adrijaSocialKpi?: AdrijaSocialKpiPayload | null
  monthlyPercentages?: {
    checklist: number
    delegation: number
    supportFMS: number
  }
  weeklyProgress?: {
    weeks: string[]
    checklist: number[]
    delegation: number[]
    supportFMS: number[]
    successKpi?: number[]
  }
}

export interface SoumyaTrendWeek {
  week_start: string
  escalation_count: number
  sla_breach_count: number
  avg_resolution_hours?: number
}

export interface SoumyaStage2VolumeCard {
  bucket_0_24: number
  bucket_24_72: number
  bucket_72_plus: number
  total: number
  labels: { safe: string; warning: string; breach: string }
  colors: { safe: string; warning: string; breach: string }
}

export interface SoumyaDelayRankedTicket {
  rank: number
  id?: string
  reference_no?: string
  title?: string
  description?: string
  company_name?: string
  type?: string
  priority?: string
  delay_score: number
  delay_hours: number
  delay_display?: string
  delay_messages?: string[]
  delay_types: string[]
  delay_label: string
}

export interface SoumyaCardDetailRow {
  id?: string
  reference_no?: string
  title?: string
  description?: string
  company_name?: string
  type?: string
  priority?: string
  delay_hours: number
  delay_display?: string
  delay_messages?: string[]
  delay_label: string
  delay_score?: number
}

export type SoumyaCardDetailKey =
  | 'stage2_volume'
  | 'avg_resolution'
  | 'escalation_frequency'
  | 'deadline_adherence'
  | 'weekly_sla_breach'
  | 'pending_staging'

export interface SoumyaDashboardResponse {
  success: boolean
  person: string
  generated_at: string
  cards: {
    stage2_volume: SoumyaStage2VolumeCard
    avg_resolution: {
      avg_hours: number
      avg_display: string
      sample_size: number
      target_hours: number
      on_target: boolean
      status: 'green' | 'red'
      trend_weeks: SoumyaTrendWeek[]
    }
    escalation_frequency: {
      count_this_week: number
      target_max: number
      on_target: boolean
      trend_weeks: SoumyaTrendWeek[]
    }
    deadline_adherence: {
      percent: number
      percent_display?: string
      on_time: number
      total_with_deadline: number
      total_closed?: number
      target_percent: number
      has_data?: boolean
      on_target: boolean
      status: 'green' | 'red' | 'neutral'
    }
    weekly_sla_breach: {
      count_this_week: number
      target: number
      on_target: boolean
      trend_weeks: SoumyaTrendWeek[]
    }
    pending_staging: {
      total: number
      chores_bugs: number
      features: number
      other?: number
    }
  }
  delay_ranked_tickets: SoumyaDelayRankedTicket[]
  card_details?: {
    stage2_volume: SoumyaCardDetailRow[]
    avg_resolution: SoumyaCardDetailRow[]
    escalation_frequency: SoumyaCardDetailRow[]
    deadline_adherence: SoumyaCardDetailRow[]
    deadline_on_time?: SoumyaCardDetailRow[]
    deadline_late?: SoumyaCardDetailRow[]
    weekly_sla_breach: SoumyaCardDetailRow[]
    pending_staging?: SoumyaCardDetailRow[]
  }
  meta: {
    data_as_of?: string
    cards_use_week_arrivals?: boolean
    month?: string
    year?: string
    week?: string
    week_start?: string
    week_end?: string
    week_label?: string
    max_week_index?: number
    leaderboard_scope?: 'week' | 'all'
    total_tickets_scanned: number
    leaderboard_pool_size?: number
    total_in_pool?: number
    total_ranked?: number
    ranked_count: number
    ranked_offset?: number
    ranked_limit?: number
    has_more?: boolean
    excludes_demo_c?: boolean
  }
}

export const dashboardKpiApi = {
  getSoumyaKpi: (params: {
    month: string
    year: string
    week: string
    leaderboard_scope?: 'week' | 'all'
    ranked_offset?: number
    ranked_limit?: number
  }) =>
    apiClient
      .get<SoumyaDashboardResponse>('/dashboard/soumya-kpi', { params })
      .then((r) => r.data),

  getData: (filters: { name: string; month: string; year: string; week: string }) =>
    apiClient
      .get<DashboardKpiResponse>('/dashboard/kpi', {
        params: {
          name: filters.name,
          month: filters.month,
          year: filters.year,
          week: filters.week,
        },
      })
      .then((r) => r.data),

  getKpiDailyLog: (year: number, month: number) =>
    apiClient
      .get<{ rows: KpiDailyLogApiRow[] }>('/dashboard/kpi-daily-log', {
        params: { year, month },
      })
      .then((r) => r.data),

  putKpiDailyLog: (body: KpiDailyLogApiRow) =>
    apiClient.put<{ ok: boolean; work_date: string }>('/dashboard/kpi-daily-log', body).then((r) => r.data),

  getAdrijaSocialKpiDaily: (year: number, month: number) =>
    apiClient
      .get<{ rows: AdrijaSocialKpiDailyRow[] }>('/dashboard/adrija-social-kpi-daily', {
        params: { year, month },
      })
      .then((r) => r.data),

  putAdrijaSocialKpiDaily: (
    rows: Pick<
      AdrijaSocialKpiDailyRow,
      'work_date' | 'post' | 'reel' | 'linkedin' | 'post_task_name' | 'reel_task_name' | 'linkedin_task_name'
    >[],
  ) =>
    apiClient
      .put<{ ok: boolean; saved: number }>('/dashboard/adrija-social-kpi-daily', { rows })
      .then((r) => r.data),
}
