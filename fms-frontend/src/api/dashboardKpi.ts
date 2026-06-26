import { apiClient } from './axios'
import {
  API_CACHE_TTL_MS,
  sessionApiCacheGet,
  sessionApiCacheRemove,
  sessionApiCacheSet,
} from '../utils/sessionApiCache'

export function dashboardKpiCacheKey(filters: { name: string; month: string; year: string; week: string }) {
  return `dashboardKpi:${filters.name}:${filters.year}:${filters.month}:${filters.week}`
}

export type SupportFmsDetailPillar = 'response_delay' | 'completion_delay' | 'pending'

export function supportFmsDetailsCacheKey(
  filters: { name: string; month: string; year: string; week: string },
  pillar: SupportFmsDetailPillar,
) {
  return `dashboardKpi:supportFms:${filters.name}:${filters.year}:${filters.month}:${filters.week}:${pillar}`
}

export function soumyaKpiCacheKey(params: {
  month: string
  year: string
  week: string
  leaderboard_scope?: string
  ranked_offset?: number
  ranked_limit?: number
}) {
  return `dashboardKpi:soumya:${params.year}:${params.month}:${params.week}:${params.leaderboard_scope ?? 'week'}:${params.ranked_offset ?? 0}:${params.ranked_limit ?? 25}`
}

/** Warm one person KPI (sidebar hover, chooser card, header menu). */
export function prefetchDashboardKpiPerson(
  name: DashboardKpiPerson,
  filters: { month: string; year: string; week: string },
): void {
  if (name === 'Soumya') {
    void dashboardKpiApi
      .getSoumyaKpi({ ...filters, leaderboard_scope: 'week', ranked_offset: 0, ranked_limit: 25 })
      .catch(() => {})
    return
  }
  if (name === 'Souvik') {
    void dashboardKpiApi.getSouvikKpi().catch(() => {})
    // Souvik also shows the standard Checklist/Delegation + percentages.
  }
  void dashboardKpiApi.getData({ name, ...filters }).catch(() => {})
}

export const DASHBOARD_KPI_NAMES = ['Shreyasi', 'Rimpa', 'Akash', 'Adrija', 'Soumya', 'Souvik'] as const
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
  /** Pillar on-time % (0 delays/pending => 100). */
  healthPercent?: number
  /** "Good" when value is 0 (no delays/pending in this pillar). */
  status?: string | null
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

export interface AkashBulkUploadBlock {
  ticketsLogged?: number
  /** Fixed weekly target (5 = 100%) */
  weeklyTarget?: number
  scorePercent?: number
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
  bulkUpload?: AkashBulkUploadBlock
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
  bulk_upload_tickets?: number | null
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
    pocIncluded?: boolean
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
    /** Month average of weekly Support FMS % (weeks 1–N in selected month). */
    monthlyPercentage?: number
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
      /** Total chores/bugs with query arrival in the selected week */
      target: number
      weekly_total?: number
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

export interface SouvikKpiRow {
  key: string
  label: string
  formula: string
  weight_percent: number
  /** 6 weekday slots Mon–Sat; null = blank cell. */
  daily: Array<number | null>
  weekly_score: number
}

export interface SouvikKpiArea {
  key: string
  title: string
  weight_percent: number
  kpis: SouvikKpiRow[]
  day_subtotals: number[]
  weekly_subtotal: number
}

export interface SouvikKpiWeekResponse {
  success: boolean
  week_start: string
  week_end: string
  week_label: string
  day_names: string[]
  day_dates: string[]
  areas: SouvikKpiArea[]
  composite_score: number
  weekly_percentage: number
  grade: string
  status: 'green' | 'amber' | 'red'
  area_scores: Record<string, number>
  can_edit: boolean
}

export interface SouvikWeeklyLogRow {
  week_from: string
  week_to: string
  week_from_label: string
  week_to_label: string
  payment_score: number
  accounts_score: number
  ea_score: number
  composite_score: number | null
  weekly_percentage: number | null
  grade: string
  auto_comment: string
  is_current_week: boolean
  has_data: boolean
}

export interface SouvikWeeklyLogResponse {
  success: boolean
  first_monday: string
  weeks: number
  rows: SouvikWeeklyLogRow[]
}

export interface SouvikReferenceKpi {
  key: string
  label: string
  formula: string
  frequency: string
  data_source: string
  weight_percent: number
}

export interface SouvikReferenceResponse {
  success: boolean
  areas: Array<{
    key: string
    title: string
    weight_percent: number
    kpis: SouvikReferenceKpi[]
  }>
  scoring_guide: Array<{ range: string; label: string }>
}

/** Load team KPIs in small parallel batches to avoid saturating the API after login. */
export async function fetchDashboardKpiBatch(
  names: readonly string[],
  filters: { month: string; year: string; week: string },
  concurrency = 2,
): Promise<Array<{ name: string; res: DashboardKpiResponse }>> {
  const out: Array<{ name: string; res: DashboardKpiResponse }> = []
  for (let i = 0; i < names.length; i += concurrency) {
    const chunk = names.slice(i, i + concurrency)
    const part = await Promise.all(
      chunk.map((name) =>
        dashboardKpiApi.getData({ name, ...filters }).then((res) => ({ name, res })),
      ),
    )
    out.push(...part)
  }
  return out
}

export const dashboardKpiApi = {
  getSoumyaKpi: async (params: {
    month: string
    year: string
    week: string
    leaderboard_scope?: 'week' | 'all'
    ranked_offset?: number
    ranked_limit?: number
  }) => {
    const key = soumyaKpiCacheKey(params)
    const cached = sessionApiCacheGet<SoumyaDashboardResponse>(key)
    if (cached) return cached
    const data = await apiClient
      .get<SoumyaDashboardResponse>('/dashboard/soumya-kpi', { params })
      .then((r) => r.data)
    sessionApiCacheSet(key, data, API_CACHE_TTL_MS.dashboardSoumyaKpi)
    return data
  },

  getData: async (
    filters: { name: string; month: string; year: string; week: string },
    options?: { includeProgress?: boolean },
  ) => {
    const includeProgress = options?.includeProgress === true
    const key = includeProgress ? `${dashboardKpiCacheKey(filters)}:progress` : dashboardKpiCacheKey(filters)
    const cached = sessionApiCacheGet<DashboardKpiResponse>(key)
    if (cached) return cached
    const data = await apiClient
      .get<DashboardKpiResponse>('/dashboard/kpi', {
        params: {
          name: filters.name,
          month: filters.month,
          year: filters.year,
          week: filters.week,
          include_progress: includeProgress,
        },
      })
      .then((r) => r.data)
    sessionApiCacheSet(key, data, API_CACHE_TTL_MS.dashboardKpi)
    return data
  },

  getSupportFmsDetails: async (
    filters: { name: string; month: string; year: string; week: string },
    pillar: SupportFmsDetailPillar,
  ) => {
    const key = supportFmsDetailsCacheKey(filters, pillar)
    const cached = sessionApiCacheGet<{ success: boolean; items: SupportFmsDelayItem[] }>(key)
    if (cached) return cached
    const data = await apiClient
      .get<{ success: boolean; items: SupportFmsDelayItem[]; error?: string }>(
        '/dashboard/kpi/support-fms-details',
        {
          params: { ...filters, pillar },
          timeout: 60000,
        },
      )
      .then((r) => r.data)
    sessionApiCacheSet(key, data, API_CACHE_TTL_MS.dashboardKpiSupportFmsDetails)
    return data
  },

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

  getSouvikKpi: (weekStart?: string) => {
    const key = `dashboardKpi:souvik:week:${weekStart ?? 'current'}`
    const cached = sessionApiCacheGet<SouvikKpiWeekResponse>(key)
    if (cached) return Promise.resolve(cached)
    return apiClient
      .get<SouvikKpiWeekResponse>('/dashboard/souvik-kpi', {
        params: weekStart ? { week_start: weekStart } : undefined,
      })
      .then((r) => {
        sessionApiCacheSet(key, r.data, API_CACHE_TTL_MS.dashboardKpi)
        return r.data
      })
  },

  getSouvikWeeklyLog: (start?: string, weeks = 52) =>
    apiClient
      .get<SouvikWeeklyLogResponse>('/dashboard/souvik-kpi/weekly-log', {
        params: { ...(start ? { start } : {}), weeks },
      })
      .then((r) => r.data),

  getSouvikReference: () => {
    const key = 'dashboardKpi:souvik:reference'
    const cached = sessionApiCacheGet<SouvikReferenceResponse>(key)
    if (cached) return Promise.resolve(cached)
    return apiClient
      .get<SouvikReferenceResponse>('/dashboard/souvik-kpi/reference')
      .then((r) => {
        sessionApiCacheSet(key, r.data, API_CACHE_TTL_MS.dashboardKpi)
        return r.data
      })
  },

  putSouvikDaily: (rows: Array<{ work_date: string; kpi_key: string; score: number | null }>) =>
    apiClient
      .put<{ ok: boolean; saved: number }>('/dashboard/souvik-kpi/daily', { rows })
      .then((r) => r.data),

  clearSouvikCache: (weekStart?: string) => {
    sessionApiCacheRemove(`dashboardKpi:souvik:week:${weekStart ?? 'current'}`)
  },
}
