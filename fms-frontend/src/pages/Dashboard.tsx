import { Typography, Row, Col, Card, Statistic, Button, Alert, Modal, Table, Tag, Form, Input, message, Space } from 'antd'
import {
  FileTextOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  RocketOutlined,
} from '@ant-design/icons'
import { useEffect, useMemo, useRef, useState, lazy, Suspense, type ReactNode } from 'react'
import dayjs from 'dayjs'
import { useLocation, useNavigate } from 'react-router-dom'
import { dashboardApi, type DashboardDetailTicket, type TrendPoint } from '../api/dashboard'

const DashboardTrendCharts = lazy(() =>
  import('./Dashboard/DashboardTrendCharts').then((m) => ({ default: m.DashboardTrendCharts })),
)
import { ticketsApi } from '../api/tickets'
import { leadsApi, type ActiveLeadRow } from '../api/leads'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import {
  ChartAreaSkeleton,
  ModalContentSkeleton,
  SkeletonOverlay,
  TableWithSkeletonLoading,
} from '../components/common/skeletons'
import { PrintExport } from '../components/common/PrintExport'
import {
  TICKET_EXPORT_COLUMNS,
  buildTicketExportRow,
  getChoresBugsCurrentStage,
} from '../utils/helpers'
import { ROUTES } from '../utils/constants'
import { useAuth } from '../hooks/useAuth'
import {
  DASHBOARD_KPI_NAMES,
  fetchDashboardKpiBatch,
  MONTHS,
  type DashboardKpiPerson,
  type DashboardKpiResponse,
} from '../api/dashboardKpi'
import { getDefaultPreviousWeekFilter } from './Dashboard/kpiWeekUtils'
import type { Ticket } from '../api/tickets'
import type { DashboardMetrics } from '../api/dashboard'
import {
  DASHBOARD_CROSS_TAB_BUMP_KEY,
  sessionApiCacheClearLogicalPrefix,
  sessionApiCacheGet,
  ticketsListLogicalKey,
} from '../utils/sessionApiCache'

/** Export/print dataset only — not needed to paint KPI cards; loaded after metrics+trends */
const DASHBOARD_EXPORT_TICKET_PARAMS = { limit: 100, types_in: 'chore,bug' } as const

const ACTIVE_LEAD_STAGE_COLORS: Record<string, string> = {
  'Demo Completed': '#22c55e',
  'Demo Schedule': '#f97316',
  'Brochure': '#86efac',
  'Account Setup': '#86efac',
  'Quotation': '#22d3ee',
  'Lead': '#e0f2fe',
  'Contacted': '#bae6fd',
  'PO': '#a78bfa',
  'Implementation Invoice': '#fbbf24',
  'Item Setup': '#c4b5fd',
  'Training': '#67e8f9',
  'First Invoice': '#34d399',
  'First Invoice Payment': '#10b981',
}

const { Title, Text } = Typography

const KPI_DASHBOARD_LINK_LABELS: Record<DashboardKpiPerson, string> = {
  Shreyasi: 'Shreyasi Dashboard',
  Rimpa: 'Rimpa Dashboard',
  Akash: 'Akash Dashboard',
  Adrija: 'Adrija Dashboard',
  Soumya: 'Soumya Dashboard',
  Souvik: 'Souvik Dashboard',
}

function formatDateTime(v?: string | null): string {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('DD-MM-YY hh:mm:ss A') : '—'
}

/** Metric chips for Team KPI cards — each segment stays on one line to avoid splits like "Support FMS" / "0%". */
function kpiWeeklySnapshotParts(
  data: DashboardKpiResponse | undefined,
  opts?: { hideSupportFms?: boolean },
): string[] {
  if (!data) return []
  const parts: string[] = []
  const c = data.checklist?.weeklyPercentage
  if (c != null && Number.isFinite(Number(c))) parts.push(`Checklist ${c}%`)
  const del = data.delegation?.weeklyPercentage
  if (del != null && Number.isFinite(Number(del))) parts.push(`Delegation ${del}%`)
  if (!opts?.hideSupportFms) {
    const sup = data.supportFMS?.weeklyPercentage
    const supportPct = Number.isFinite(Number(sup)) ? Number(sup) : 0
    parts.push(`Support FMS ${supportPct}%`)
  }
  if (data.successKpi != null) parts.push(`Success KPI ${data.successKpi.overallPercentage ?? 0}%`)
  const ad = data.adrijaSocialKpi?.weeklyPercent
  if (ad != null && Number.isFinite(Number(ad))) parts.push(`Adrija social (week) ${ad}%`)
  return parts
}

function formatINR(n: number): string {
  try {
    return new Intl.NumberFormat('en-IN').format(n)
  } catch {
    return String(n)
  }
}

/** Same display for Tag (T1) and Tag (T2): name + email when both exist */
function formatTagColumn(name?: string | null, email?: string | null) {
  const n = (name || '').trim()
  const e = (email || '').trim()
  if (n && e) return `${n} (${e})`
  return n || e || '—'
}

const lightPanel = {
  background: '#ffffff',
  border: '1px solid rgba(0, 0, 0, 0.06)',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
}
const metricCardColors = [
  { borderLeft: '3px solid #3b82f6', iconColor: '#3b82f6', ...lightPanel },
  { borderLeft: '3px solid #06b6d4', iconColor: '#06b6d4', ...lightPanel },
  { borderLeft: '3px solid #eab308', iconColor: '#eab308', ...lightPanel },
  { borderLeft: '3px solid #22c55e', iconColor: '#22c55e', ...lightPanel },
  { borderLeft: '3px solid #3b82f6', iconColor: '#3b82f6', ...lightPanel },
  { borderLeft: '3px solid #8b5cf6', iconColor: '#8b5cf6', ...lightPanel },
  { borderLeft: '3px solid #0ea5e9', iconColor: '#0ea5e9', ...lightPanel },
  { borderLeft: '3px solid #14b8a6', iconColor: '#14b8a6', ...lightPanel },
  { borderLeft: '3px solid #ef4444', iconColor: '#ef4444', ...lightPanel },
  { borderLeft: '3px solid #8b5cf6', iconColor: '#8b5cf6', ...lightPanel },
  { borderLeft: '3px solid #14b8a6', iconColor: '#14b8a6', ...lightPanel },
]

export const Dashboard = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const emailLower = (user?.email || '').trim().toLowerCase()
  /** Full custom KPIs: payments + delegation */
  const customDashboardFullEmails = new Set(['ad@ip.com', 'ayush@industryprime.com'])
  /** Payment KPIs only (Total Rec Amount + Total Due) */
  const customDashboardPaymentOnlyEmails = new Set(['ea@industryprime.com'])
  const isCustomDashboardFullUser = emailLower ? customDashboardFullEmails.has(emailLower) : false
  const isCustomDashboardPaymentOnlyUser = emailLower ? customDashboardPaymentOnlyEmails.has(emailLower) : false
  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [allFetchedTickets, setAllFetchedTickets] = useState<Ticket[]>([])
  const [error, setError] = useState<string | null>(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [detailMetric, setDetailMetric] = useState<string | null>(null)
  const [detailTitle, setDetailTitle] = useState('')
  const [detailData, setDetailData] = useState<DashboardDetailTicket[]>([])
  const [delegationDateFilter, setDelegationDateFilter] = useState<dayjs.Dayjs | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const hideCompanyColumnInDelegation = detailMetric === 'custom_pending_delegation'
  const isPaymentKpiDetail =
    detailMetric === 'custom_total_rec_amount' || detailMetric === 'custom_total_due'
  const [activeLeads, setActiveLeads] = useState<ActiveLeadRow[]>([])
  const [activeLeadsLoading, setActiveLeadsLoading] = useState(false)
  const [paymentActions, setPaymentActions] = useState<
    Array<{
      client_payment_id: string
      company_name?: string
      invoice_number?: string
      reference_no?: string
      tagged_user_name?: string | null
      tagged_user_email?: string | null
      tagged_user_2_name?: string | null
      tagged_user_2_email?: string | null
      pending_payment_tag?: 't1' | 't2' | 'completed'
    }>
  >([])
  const [paymentActionsLoading, setPaymentActionsLoading] = useState(false)
  const [paymentActionModalOpen, setPaymentActionModalOpen] = useState(false)
  const [paymentActionRow, setPaymentActionRow] = useState<{
    client_payment_id: string
    company_name?: string
    reference_no?: string
    pending_payment_tag?: 't1' | 't2' | 'completed'
  } | null>(null)
  const [paymentActionSubmitting, setPaymentActionSubmitting] = useState(false)
  const [paymentActionForm] = Form.useForm<{ person: string; remarks: string }>()
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>([])
  const [kpiSnapshotByPerson, setKpiSnapshotByPerson] = useState<Partial<Record<DashboardKpiPerson, DashboardKpiResponse>>>({})
  const [kpiSnapshotLoading, setKpiSnapshotLoading] = useState(false)
  const [successKpiPreviousWeek, setSuccessKpiPreviousWeek] = useState<DashboardKpiResponse['successKpi'] | null>(null)
  const [successPerformanceLoading, setSuccessPerformanceLoading] = useState(false)
  const [successDetailModal, setSuccessDetailModal] = useState<{
    key: 'poc' | 'training' | 'followup' | 'increase'
    title: string
    rows: Array<Record<string, unknown>>
  } | null>(null)

  /** Invalidates in-flight dashboard fetch when effect re-runs (e.g. React StrictMode) so stale responses are ignored. */
  const dashboardFetchGen = useRef(0)

  useEffect(() => {
    const restoreY = (location.state as { restoreScrollY?: number } | null)?.restoreScrollY
    if (typeof restoreY !== 'number' || !Number.isFinite(restoreY)) return
    // Restore last viewport after returning from Dashboard KPI person view.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo({ top: Math.max(0, restoreY), behavior: 'auto' })
        navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
      })
    })
  }, [location.pathname, location.search, location.state, navigate])

  useEffect(() => {
    if (!isCustomDashboardFullUser) {
      setKpiSnapshotByPerson({})
      return
    }
    const prev = getDefaultPreviousWeekFilter()
    const month = MONTHS[prev.monthIndex] ?? MONTHS[0]
    const year = prev.year
    const week = `week ${prev.week}`
    setKpiSnapshotLoading(true)
    const delayMs = 6000
    const timer = window.setTimeout(() => {
      void fetchDashboardKpiBatch(DASHBOARD_KPI_NAMES, { month, year, week }, 2)
      .then((results) => {
        const next: Partial<Record<DashboardKpiPerson, DashboardKpiResponse>> = {}
        for (const { name, res } of results) {
          if (res && res.success !== false) next[name] = res
        }
        setKpiSnapshotByPerson(next)
      })
      .catch(() => setKpiSnapshotByPerson({}))
      .finally(() => setKpiSnapshotLoading(false))
    }, delayMs)
    return () => window.clearTimeout(timer)
  }, [isCustomDashboardFullUser])

  useEffect(() => {
    if (!isCustomDashboardFullUser) {
      setSuccessKpiPreviousWeek(null)
      return
    }
    const timer = window.setTimeout(() => {
      setSuccessPerformanceLoading(true)
      const prev = getDefaultPreviousWeekFilter()
      const month = MONTHS[prev.monthIndex] ?? MONTHS[0]
      const { year, week: weekNum } = prev
      const week = `week ${weekNum}`
      void dashboardKpiApi
        .getData({ name: 'Rimpa', month, year, week })
        .then((res) => setSuccessKpiPreviousWeek(res?.successKpi ?? null))
        .catch(() => setSuccessKpiPreviousWeek(null))
        .finally(() => setSuccessPerformanceLoading(false))
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [isCustomDashboardFullUser])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPaymentActionsLoading(true)
      setActiveLeadsLoading(true)
      const promises: Promise<void>[] = [
        leadsApi.listActive().then((res) => setActiveLeads(res.leads || [])).catch(() => setActiveLeads([])),
      ]
      if (user) {
        promises.push(
          dashboardApi.getPaymentActions().then((res) => setPaymentActions(res.items || [])).catch(() => setPaymentActions([])),
        )
      } else {
        setPaymentActions([])
      }
      void Promise.all(promises).finally(() => {
        setPaymentActionsLoading(false)
        setActiveLeadsLoading(false)
      })
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [user?.role, user?.email, user?.id])

  const isFullPaymentViewer =
    user?.role === 'master_admin' ||
    user?.role === 'admin' ||
    (user?.email || '').toLowerCase() === 'sk@industryprime.com'

  const paymentActionColumns = useMemo(
    () => [
      { title: 'Company', dataIndex: 'company_name', key: 'company_name', render: (v: string) => v || '—' },
      { title: 'Invoice Number', dataIndex: 'invoice_number', key: 'invoice_number', render: (v: string) => v || '—' },
      { title: 'Reference', dataIndex: 'reference_no', key: 'reference_no', render: (v: string) => v || '—' },
      {
        title: 'Tags (T1 & T2)',
        key: 'tags',
        width: 280,
        render: (
          _: unknown,
          r: {
            tagged_user_name?: string | null
            tagged_user_email?: string | null
            tagged_user_2_name?: string | null
            tagged_user_2_email?: string | null
          }
        ) => (
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            <div>
              <Text type="secondary">T1: </Text>
              {formatTagColumn(r.tagged_user_name, r.tagged_user_email)}
            </div>
            <div style={{ marginTop: 4 }}>
              <Text type="secondary">T2: </Text>
              {formatTagColumn(r.tagged_user_2_name, r.tagged_user_2_email)}
            </div>
          </div>
        ),
      },
      {
        title: 'Step',
        key: 'step',
        width: 100,
        render: (_: unknown, r: { pending_payment_tag?: 't1' | 't2' | 'completed' }) => {
          if (r.pending_payment_tag === 'completed') {
            return <Tag color="success">Done</Tag>
          }
          return (
            <Tag color={r.pending_payment_tag === 't2' ? 'blue' : 'default'}>
              {r.pending_payment_tag === 't2' ? 'T2' : 'T1'}
            </Tag>
          )
        },
      },
      {
        title: 'Action',
        key: 'action',
        render: (
          _: unknown,
          row: {
            client_payment_id: string
            company_name?: string
            reference_no?: string
            pending_payment_tag?: 't1' | 't2' | 'completed'
          }
        ) =>
          row.pending_payment_tag === 'completed' ? (
            <Text type="secondary">Recorded</Text>
          ) : (
            <Button
              type="primary"
              size="small"
              onClick={() => {
                setPaymentActionRow(row)
                paymentActionForm.resetFields()
                setPaymentActionModalOpen(true)
              }}
            >
              Submit
            </Button>
          ),
      },
    ],
    []
  )

  const applyTicketsListResponse = (ticketsResVal: unknown, gen: number) => {
    if (gen !== dashboardFetchGen.current) return
    const raw =
      ticketsResVal && typeof ticketsResVal === 'object' ? (ticketsResVal as { data?: unknown }).data : undefined
    const tickets: Ticket[] = Array.isArray(raw) ? (raw as Ticket[]) : []
    setAllFetchedTickets(tickets)
  }

  const fetchData = async (gen: number) => {
    if (gen !== dashboardFetchGen.current) return
    setError(null)
    const exportListKey = ticketsListLogicalKey(DASHBOARD_EXPORT_TICKET_PARAMS as object)
    const cachedMetrics = sessionApiCacheGet<DashboardMetrics>('dashboard:metrics')
    const cachedTrends = sessionApiCacheGet<{ data: TrendPoint[] }>('dashboard:trends')
    const cachedTickets = sessionApiCacheGet<{ data?: Ticket[] }>(exportListKey)

    if (cachedMetrics) {
      if (gen !== dashboardFetchGen.current) return
      setMetrics(cachedMetrics)
      if (cachedTrends?.data != null) {
        setTrendPoints(Array.isArray(cachedTrends.data) ? cachedTrends.data : [])
      }
      if (cachedTickets) applyTicketsListResponse(cachedTickets, gen)
      setLoading(false)
    } else {
      setLoading(true)
    }

    try {
      const bootstrapRes = await dashboardApi.getBootstrap().catch(() => null)
      if (gen !== dashboardFetchGen.current) return
      if (bootstrapRes?.metrics) {
        setMetrics(bootstrapRes.metrics)
        setTrendPoints(Array.isArray(bootstrapRes.trends) ? bootstrapRes.trends : [])
      } else {
        setMetrics(null)
        if (!cachedTrends) setTrendPoints([])
      }
    } catch (err) {
      console.error('Dashboard fetch error:', err)
      if (gen === dashboardFetchGen.current) {
        setError('Failed to load dashboard. Check backend connection.')
      }
    } finally {
      if (gen === dashboardFetchGen.current) {
        setLoading(false)
      }
    }

    // Export tickets are not needed for KPI cards — load after first paint.
    const scheduleDeferred =
      typeof requestIdleCallback === 'function'
        ? (cb: () => void) => requestIdleCallback(cb, { timeout: 4000 })
        : (cb: () => void) => window.setTimeout(cb, 800)
    scheduleDeferred(() => {
      if (gen !== dashboardFetchGen.current) return
      void ticketsApi
        .list(DASHBOARD_EXPORT_TICKET_PARAMS)
        .then((ticketsResVal) => applyTicketsListResponse(ticketsResVal, gen))
        .catch(() => {
          if (gen !== dashboardFetchGen.current) return
          if (!cachedTickets) setAllFetchedTickets([])
        })
    })
  }

  useEffect(() => {
    const gen = ++dashboardFetchGen.current
    void fetchData(gen)
    return () => {
      dashboardFetchGen.current += 1
    }
    // Mount-only: fetchData closes over latest state setters; gen guards stale StrictMode/unmount races.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Client Payment runs on another route/tab; sessionStorage is per-tab, so NA/payment updates broadcast via localStorage. */
  useEffect(() => {
    const refetchMetricsFromServer = () => {
      sessionApiCacheClearLogicalPrefix('dashboard:')
      const gen = ++dashboardFetchGen.current
      void (async () => {
        try {
          const m = await dashboardApi.getMetrics({ skipCache: true })
          if (gen === dashboardFetchGen.current) setMetrics(m)
        } catch {
          /* keep previous metrics */
        }
      })()
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key !== DASHBOARD_CROSS_TAB_BUMP_KEY || e.newValue == null) return
      refetchMetricsFromServer()
    }
    window.addEventListener('storage', onStorage)

    const onPaymentNaChanged = () => {
      refetchMetricsFromServer()
    }
    window.addEventListener('client-payment-na-changed', onPaymentNaChanged)

    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('client-payment-na-changed', onPaymentNaChanged)
    }
  }, [])

  const safeMetrics: DashboardMetrics = metrics ?? {
    all_tickets: 0,
    pending_till_date: 0,
    total_pending_bug_till_date: 0,
    pending_till_date_exclude_demo_c: 0,
    pending_chores_include_demo_c: 0,
    feature_excluding_demo_c: 0,
    feature_with_demo_c: 0,
    response_delay: 0,
    completion_delay: 0,
    total_last_week: 0,
    pending_last_week: 0,
    staging_pending_feature: 0,
    staging_pending_chores_bugs: 0,
    custom_received_monthly: 0,
    custom_received_quarterly: 0,
    custom_received_half_yearly: 0,
    custom_received_yearly: 0,
    custom_total_due: 0,
    custom_raised_all: 0,
    custom_pending_delegation: 0,
    custom_received_in_fy_quarter: undefined,
  }

  const customReceivedGenreFallback =
    Number(safeMetrics.custom_received_monthly) +
    Number(safeMetrics.custom_received_quarterly) +
    Number(safeMetrics.custom_received_half_yearly) +
    Number(safeMetrics.custom_received_yearly)
  const customReceivedTotal =
    typeof safeMetrics.custom_received_in_fy_quarter === 'number'
      ? safeMetrics.custom_received_in_fy_quarter
      : customReceivedGenreFallback

  const baseMetricCards = [
    { title: 'Total Pending Bug (till date)', metricKey: 'total_pending_bug', value: Number(safeMetrics.total_pending_bug_till_date) ?? 0, icon: <FileTextOutlined /> },
    { title: 'Response Delay', metricKey: 'response_delay', value: Number(safeMetrics.response_delay) || 0, icon: <ClockCircleOutlined /> },
    { title: 'Completion Delay', metricKey: 'completion_delay', value: Number(safeMetrics.completion_delay) || 0, icon: <WarningOutlined /> },
    { title: 'Total (Last Week)', metricKey: 'total_last_week', value: Number(safeMetrics.total_last_week) || 0, icon: <FileTextOutlined /> },
    { title: 'Pending (till date) Excl. Demo C', metricKey: 'pending_exclude_demo_c', value: Number(safeMetrics.pending_till_date_exclude_demo_c) ?? 0, icon: <CheckCircleOutlined /> },
    { title: 'Pending Chores (Demo C)', metricKey: 'pending_chores_demo_c', value: Number(safeMetrics.pending_chores_include_demo_c) ?? 0, icon: <CheckCircleOutlined /> },
    { title: 'Feature Excluding Demo C', metricKey: 'feature_exclude_demo_c', value: Number(safeMetrics.feature_excluding_demo_c) ?? 0, icon: <RocketOutlined /> },
    { title: 'Feature with Demo C', metricKey: 'feature_with_demo_c', value: Number(safeMetrics.feature_with_demo_c) ?? 0, icon: <RocketOutlined /> },
  ]

  const paymentOnlyCards = [
    {
      title: 'Total Rec Amount',
      metricKey: 'custom_total_rec_amount',
      value: Number(customReceivedTotal) || 0,
      icon: <FileTextOutlined />,
    },
    {
      title: 'Total DUE',
      metricKey: 'custom_total_due',
      /** All unpaid (excl. NA) — "due till now" */
      value: Number(safeMetrics.custom_total_due) || 0,
      /** Current FY quarter raised (excl. NA) — matches Client Payment Overall card */
      raisedQuarter: Number(safeMetrics.custom_raised_quarter) || 0,
      icon: <WarningOutlined />,
    },
  ]
  const delegationCard = {
    title: 'Total Pending Delegation',
    metricKey: 'custom_pending_delegation',
    value: Number(safeMetrics.custom_pending_delegation) || 0,
    icon: <CheckCircleOutlined />,
  }
  const customMetricCards = isCustomDashboardPaymentOnlyUser
    ? paymentOnlyCards
    : isCustomDashboardFullUser
      ? [...paymentOnlyCards, delegationCard]
      : []

  const metricCards = [...baseMetricCards, ...customMetricCards]

  const stagingCardsData = useMemo(
    () => [
      {
        title: isCustomDashboardFullUser ? 'Feature Pending in Staging' : 'Feature Pending',
        metricKey: 'staging_feature',
        value: Number(safeMetrics.staging_pending_feature) || 0,
        icon: <RocketOutlined />,
        color: '#3b82f6',
      },
      {
        title: isCustomDashboardFullUser ? 'Chores & Bug Pending in Staging' : 'Chores & Bug Pending',
        metricKey: 'staging_chores_bugs',
        value: Number(safeMetrics.staging_pending_chores_bugs) || 0,
        icon: <FileTextOutlined />,
        color: '#22c55e',
      },
    ],
    [
      isCustomDashboardFullUser,
      safeMetrics.staging_pending_feature,
      safeMetrics.staging_pending_chores_bugs,
    ],
  )

  const loadDetail = async (metricKey: string, title: string) => {
    setDetailMetric(metricKey)
    setDetailTitle(title)
    if (metricKey === 'custom_pending_delegation') setDelegationDateFilter(null)
    setDetailModalOpen(true)
    setDetailLoading(true)
    setDetailData([])
    try {
      const res = await dashboardApi.getDetail(metricKey)
      setDetailData(res.tickets || [])
    } catch {
      setDetailData([])
    } finally {
      setDetailLoading(false)
    }
  }

  const openTicket = (t: DashboardDetailTicket) => {
    setDetailModalOpen(false)
    const type = (t.type || '').toLowerCase()
    if (type === 'payment' || type === 'delegation') {
      return
    }
    if (type === 'feature') {
      navigate(ROUTES.TICKETS + '?type=feature', { state: { openTicketId: t.id, openTicketType: 'feature' } })
    } else {
      navigate(ROUTES.TICKETS + '?section=chores-bugs', { state: { openTicketId: t.id, openTicketType: type === 'bug' ? 'bug' : 'chore' } })
    }
  }

  const exportData = allFetchedTickets.length
    ? {
        columns: [...TICKET_EXPORT_COLUMNS],
        rows: allFetchedTickets.map((t) => buildTicketExportRow(t, getChoresBugsCurrentStage)),
      }
    : undefined

  type MetricCardDef = {
    title: string
    metricKey: string
    value: number
    icon: ReactNode
    clickable?: boolean
    raisedQuarter?: number
  }

  const filteredDetailData = useMemo(() => {
    if (detailMetric !== 'custom_pending_delegation' || !delegationDateFilter) return detailData
    const wanted = delegationDateFilter.format('YYYY-MM-DD')
    return detailData.filter((r) => {
      const raw = (r.delegationOn || '').toString().trim()
      if (!raw) return false
      const d = dayjs(raw)
      return d.isValid() && d.format('YYYY-MM-DD') === wanted
    })
  }, [detailData, detailMetric, delegationDateFilter])
  /** When `includeCol` is false, returns only the Card (caller supplies the Col) — avoids nested Col layout collapse. */
  const renderMetricStatCard = (card: MetricCardDef, i: number, keyPrefix: string, includeCol = true) => {
    const cardStyle = metricCardColors[i % metricCardColors.length] || metricCardColors[0]
    const clickable = card.clickable !== false
    const paymentRupeeCard =
      card.metricKey === 'custom_total_due' || card.metricKey === 'custom_total_rec_amount'
    const cardEl = (
      <Card
        key={includeCol ? undefined : `${keyPrefix}-${card.metricKey}-${i}`}
        onClick={clickable ? () => loadDetail(card.metricKey, card.title) : undefined}
        style={{
          width: '100%',
          borderRadius: 12,
          border: cardStyle.border,
          borderLeft: cardStyle.borderLeft,
          background: cardStyle.background,
          boxShadow: cardStyle.boxShadow,
          cursor: clickable ? 'pointer' : 'default',
        }}
        bodyStyle={{ padding: 22 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minWidth: 0 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 1,
                whiteSpace: 'normal',
                wordBreak: 'break-word',
                display: 'block',
                color: '#64748b',
              }}
            >
              {card.title}
            </Text>
            {card.metricKey === 'custom_total_due' && typeof card.raisedQuarter === 'number' ? (
              <div style={{ marginTop: 4 }}>
                <span style={{ fontSize: 24, fontWeight: 700, color: '#1e293b' }}>
                  ₹{formatINR(Number(card.value))}
                </span>
                <span style={{ fontSize: 18, fontWeight: 600, color: '#475569', margin: '0 6px' }}>/</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: '#334155' }}>
                  ₹{formatINR(Number(card.raisedQuarter))}
                </span>
              </div>
            ) : (
              <Statistic
                value={card.value}
                formatter={
                  paymentRupeeCard ? (val) => <span style={{ fontSize: 28, fontWeight: 700, color: '#1e293b' }}>₹{formatINR(Number(val))}</span> : undefined
                }
                valueStyle={{ fontSize: 28, fontWeight: 700, color: '#1e293b', marginTop: 4 }}
              />
            )}
          </div>
          <div style={{ fontSize: 28, color: cardStyle.iconColor, opacity: 0.9, flexShrink: 0 }}>{card.icon}</div>
        </div>
      </Card>
    )
    if (!includeCol) return cardEl
    return (
      <Col xs={24} sm={12} md={8} lg={6} key={`${keyPrefix}-${card.metricKey}-${i}`}>
        {cardEl}
      </Col>
    )
  }

  const paymentActionBlock = user ? (
    <>
      <Title level={4} style={{ marginBottom: 8, color: '#1e293b', fontWeight: 600, letterSpacing: 0.5 }}>
        Payment Action
      </Title>
      {!isFullPaymentViewer && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          Rows where you are tagged for T1 or T2 (pending). Master Admin / Admin sees all intercepts.
        </Text>
      )}
      {!isFullPaymentViewer && !paymentActionsLoading && paymentActions.length === 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="No payment actions for your login. If you should be tagged, check that Client Payment has your user id or email saved on the intercept."
        />
      )}
      {isFullPaymentViewer && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          Pending steps only: when T1 (and T2 if tagged) are submitted, the row leaves this list — details stay under Client Payment on the invoice.
        </Text>
      )}
      <Title level={5} style={{ marginBottom: 12, color: '#1e293b', fontWeight: 600 }}>
        Tag (T1) — Client Payment actions
      </Title>
      <Card
        style={{
          borderRadius: 12,
          border: '1px solid rgba(0, 0, 0, 0.06)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
          background: '#ffffff',
          marginBottom: 28,
        }}
        bodyStyle={{ padding: 16 }}
      >
        <TableWithSkeletonLoading loading={paymentActionsLoading} columns={7} rows={8}>
          <Table
            size="small"
            loading={false}
            dataSource={paymentActions}
            rowKey={(r) => `${r.client_payment_id}-${r.pending_payment_tag || 't1'}`}
            pagination={false}
            columns={paymentActionColumns}
            locale={{
              emptyText: isFullPaymentViewer
                ? 'No payment actions. Add intercept + Tag (T1) on Client Payment, run docs/CLIENT_PAYMENT_INTERCEPT_TAG2.sql in Supabase if T2 columns are missing.'
                : 'No rows for your account. You must be tagged for T1 or T2 on an intercept with pending payment action.',
            }}
          />
        </TableWithSkeletonLoading>
      </Card>
    </>
  ) : null

  const successPoc = successKpiPreviousWeek?.pocCollected
  const successTraining = successKpiPreviousWeek?.weeklyTrainingTarget
  const successFollowup = successKpiPreviousWeek?.trainingFollowUp
  const successIncrease = successKpiPreviousWeek?.successIncrease
  const successPocIncluded = successKpiPreviousWeek?.meta?.pocIncluded !== false
  const successCards = [
    ...(successPocIncluded
      ? [{ key: 'poc', title: 'POC Collected', current: Number(successPoc?.currentValue ?? 0) }]
      : []),
    { key: 'training', title: 'Training Target', current: Number(successTraining?.currentValue ?? 0) },
    { key: 'followup', title: 'Training Follow-up', current: Number(successFollowup?.currentValue ?? 0) },
    { key: 'increase', title: 'Success Increase', current: Number(successIncrease?.currentValue ?? 0) },
  ] as const

  const openSuccessDetail = (cardKey: 'poc' | 'training' | 'followup' | 'increase', title: string) => {
    const details =
      cardKey === 'poc'
        ? successPoc?.details
        : cardKey === 'training'
          ? successTraining?.details
          : cardKey === 'followup'
            ? successFollowup?.details
            : successIncrease?.details
    const companies = details?.companies ?? []
    const refs = details?.referenceNumbers ?? []
    const owners = details?.messageOwner ?? []
    const pocDates = details?.dates ?? []
    const responses = details?.responses ?? []
    const contacts = details?.contacts ?? []
    const callPocs = details?.callPOC ?? []
    const messagePocs = details?.messagePOC ?? []
    const trainingDates = details?.trainingDates ?? []
    const trainingStatus = details?.trainingStatus ?? []
    const remarks = details?.remarks ?? []
    const followupDates = details?.followupDates ?? []
    const beforePct = details?.beforePercentages ?? []
    const afterPct = details?.afterPercentages ?? []
    const features = details?.features ?? []

    const maxLen = Math.max(
      companies.length,
      refs.length,
      owners.length,
      pocDates.length,
      responses.length,
      contacts.length,
      callPocs.length,
      messagePocs.length,
      trainingDates.length,
      trainingStatus.length,
      remarks.length,
      followupDates.length,
      beforePct.length,
      afterPct.length,
      features.length,
    )

    const rows = Array.from({ length: maxLen }).map((_, i) => {
      if (cardKey === 'poc') {
        return {
          company: companies[i] || '—',
          reference_no: refs[i] || '—',
          message_owner: owners[i] || '—',
          date: pocDates[i] || '',
          response: responses[i] || '—',
          contact: contacts[i] || '—',
        }
      }
      if (cardKey === 'training') {
        return {
          company: companies[i] || '—',
          call_poc: callPocs[i] || '—',
          message_poc: messagePocs[i] || '—',
          training_date: trainingDates[i] || '',
          status: trainingStatus[i] || '—',
          remarks: remarks[i] || '—',
        }
      }
      const featRaw = features[i]
      const feat =
        Array.isArray(featRaw) ? featRaw.filter(Boolean).join(', ') : String(featRaw || '').trim()
      return {
        company: companies[i] || '—',
        feature: feat || '—',
        call_date: followupDates[i] || '',
        before_pct: beforePct[i] != null ? `${beforePct[i]}%` : '—',
        after_pct: afterPct[i] != null ? `${afterPct[i]}%` : '—',
      }
    })

    setSuccessDetailModal({
      key: cardKey,
      title,
      rows: rows.filter((r) => Object.values(r).some((v) => String(v ?? '').trim() !== '' && String(v) !== '—')),
    })
  }

  const successDetailColumns =
    successDetailModal?.key === 'poc'
      ? [
          { title: 'Reference No', dataIndex: 'reference_no', key: 'reference_no', width: 130 },
          { title: 'Company', dataIndex: 'company', key: 'company', width: 220 },
          { title: 'Message Owner', dataIndex: 'message_owner', key: 'message_owner', width: 140 },
          {
            title: 'Date',
            dataIndex: 'date',
            key: 'date',
            width: 180,
            render: (v: string) => formatDateTime(v),
          },
          { title: 'Response', dataIndex: 'response', key: 'response', width: 150 },
          { title: 'Contact', dataIndex: 'contact', key: 'contact', width: 140 },
        ]
      : successDetailModal?.key === 'training'
        ? [
            { title: 'Company', dataIndex: 'company', key: 'company', width: 220 },
            { title: 'Call POC', dataIndex: 'call_poc', key: 'call_poc', width: 120 },
            { title: 'Message POC', dataIndex: 'message_poc', key: 'message_poc', width: 140 },
            {
              title: 'Training Date',
              dataIndex: 'training_date',
              key: 'training_date',
              width: 180,
              render: (v: string) => formatDateTime(v),
            },
            { title: 'Status', dataIndex: 'status', key: 'status', width: 120 },
            { title: 'Remarks', dataIndex: 'remarks', key: 'remarks', width: 220 },
          ]
        : successDetailModal?.key === 'followup' || successDetailModal?.key === 'increase'
          ? [
              { title: 'Company', dataIndex: 'company', key: 'company', width: 220 },
              { title: 'Feature', dataIndex: 'feature', key: 'feature', width: 200 },
              {
                title: 'Call Date',
                dataIndex: 'call_date',
                key: 'call_date',
                width: 180,
                render: (v: string) => formatDateTime(v),
              },
              { title: 'Before %', dataIndex: 'before_pct', key: 'before_pct', width: 120 },
              { title: 'After %', dataIndex: 'after_pct', key: 'after_pct', width: 120 },
            ]
          : []

  if (loading) {
    return <LoadingSpinner fullPage />
  }

  return (
    <div
      style={{
        maxWidth: 1400,
        margin: '0 auto',
        minHeight: 400,
        padding: '8px 0',
        background: 'transparent',
        borderRadius: 16,
        whiteSpace: 'normal',
        wordBreak: 'break-word',
        overflowWrap: 'break-word',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <PrintExport pageTitle="Dashboard" exportData={exportData} exportFilename="dashboard_recent_tickets" />
      </div>
      {error && (
        <Alert
          type="error"
          message={error}
          showIcon
          action={
            <Button
              size="small"
              onClick={() => {
                const g = ++dashboardFetchGen.current
                void fetchData(g)
              }}
            >
              Retry
            </Button>
          }
          style={{ marginBottom: 24, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)' }}
        />
      )}

      {isCustomDashboardFullUser ? (
        <>
          <Title level={3} style={{ marginBottom: 8, color: '#1e293b', fontWeight: 600 }}>
            Support
          </Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            Support ticket KPIs and staging counts. Click a card to open the ticket list for that metric.
          </Text>
          <Row gutter={[20, 20]} style={{ marginBottom: 20 }}>
            {baseMetricCards.map((card, i) => renderMetricStatCard(card, i, 'support'))}
          </Row>
          <Title level={5} style={{ marginBottom: 12, color: '#1e293b', fontWeight: 600 }}>
            In staging
          </Title>
          <Row gutter={[20, 20]} style={{ marginBottom: 28 }}>
            {stagingCardsData.map((card, i) => (
              <Col xs={24} sm={12} key={`staging-custom-${i}`}>
                <Card
                  onClick={() => loadDetail(card.metricKey, card.title)}
                  style={{
                    borderRadius: 8,
                    border: '1px solid rgba(0, 0, 0, 0.06)',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
                    background: '#ffffff',
                    borderTop: `3px solid ${card.color}`,
                    cursor: 'pointer',
                  }}
                  bodyStyle={{ padding: 22 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minWidth: 0 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          whiteSpace: 'normal',
                          wordBreak: 'break-word',
                          display: 'block',
                          color: '#64748b',
                        }}
                      >
                        {card.title}
                      </Text>
                      <Statistic
                        value={card.value}
                        valueStyle={{ fontSize: 28, fontWeight: 700, color: card.color }}
                        style={{ marginTop: 4 }}
                      />
                    </div>
                    <div style={{ fontSize: 26, color: card.color, flexShrink: 0 }}>{card.icon}</div>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>

          <Title level={3} style={{ marginBottom: 8, marginTop: 8, color: '#1e293b', fontWeight: 600 }}>
            Success
          </Title>
          <SkeletonOverlay loading={successPerformanceLoading} minHeight={120}>
            <Row gutter={[20, 20]} style={{ marginBottom: 28 }}>
              {successCards.map((c) => (
                <Col xs={24} sm={12} md={12} lg={6} key={c.key}>
                  <Card
                    hoverable
                    onClick={() => openSuccessDetail(c.key as 'poc' | 'training' | 'followup' | 'increase', c.title)}
                    style={{
                      cursor: 'pointer',
                      borderRadius: 8,
                      border: '1px solid rgba(0, 0, 0, 0.06)',
                      borderTop: '3px solid #f59e0b',
                      background: '#ffffff',
                      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
                    }}
                    bodyStyle={{ padding: 22 }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: 1,
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        display: 'block',
                        color: '#64748b',
                      }}
                    >
                      {c.title}
                    </Text>
                    <Title level={4} style={{ margin: '8px 0 0 0' }}>
                      {c.current}
                    </Title>
                    <Text type="secondary">Previous week (Performance Monitoring)</Text>
                  </Card>
                </Col>
              ))}
            </Row>
          </SkeletonOverlay>

          <Title level={3} style={{ marginBottom: 8, marginTop: 8, color: '#1e293b', fontWeight: 600 }}>
            Payment
          </Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            Total received (by invoice genre), total due, and payment intercept actions.
          </Text>
          <Row gutter={[20, 20]} style={{ marginBottom: 8 }}>
            {paymentOnlyCards.map((card, i) => renderMetricStatCard(card, i, 'payment'))}
          </Row>
          {paymentActionBlock}

          <Title level={3} style={{ marginBottom: 8, marginTop: 8, color: '#1e293b', fontWeight: 600 }}>
            Task
          </Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            {`Pending delegation and each person's Dashboard KPI (weekly % for checklist, delegation, support, and role-specific rows). Click a person to open that dashboard in Dashboard KPI.`}
          </Text>
          <Row gutter={[20, 20]} style={{ marginBottom: 20 }}>
            <Col xs={24} sm={12} md={12} lg={8} key="task-delegation">
              {renderMetricStatCard(delegationCard, 0, 'delegation', false)}
            </Col>
          </Row>
          <Title level={5} style={{ marginBottom: 12, color: '#1e293b', fontWeight: 600 }}>
            Team KPI dashboards
          </Title>
          <SkeletonOverlay loading={kpiSnapshotLoading} minHeight={100}>
            <Row gutter={[16, 16]} style={{ marginBottom: 28 }}>
              {DASHBOARD_KPI_NAMES.map((person) => {
                const snapshotParts = kpiWeeklySnapshotParts(kpiSnapshotByPerson[person], {
                  hideSupportFms: person === 'Rimpa' || person === 'Adrija',
                })
                return (
                  <Col xs={24} sm={12} md={6} key={person}>
                    <Card
                      hoverable
                      style={{ cursor: 'pointer', height: '100%' }}
                      styles={{ body: { padding: '16px 18px 20px' } }}
                      onClick={() =>
                        navigate(`${ROUTES.DASHBOARD_KPI}?person=${encodeURIComponent(person)}`, {
                          state: { fromDashboard: true, restoreScrollY: window.scrollY },
                        })
                      }
                    >
                      <Title level={5} style={{ marginTop: 0, marginBottom: 6 }}>
                        {KPI_DASHBOARD_LINK_LABELS[person]}
                      </Title>
                      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
                        Weekly snapshot
                      </Text>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          columnGap: 0,
                          rowGap: 8,
                          alignItems: 'baseline',
                          lineHeight: 1.5,
                        }}
                      >
                        {snapshotParts.length === 0 ? (
                          <Text type="secondary" style={{ fontSize: 13 }}>
                            {kpiSnapshotLoading ? '…' : 'No weekly snapshot'}
                          </Text>
                        ) : (
                          snapshotParts.map((part, i) => (
                            <span
                              key={`${person}-kpi-${i}`}
                              style={{
                                whiteSpace: 'nowrap',
                                fontSize: 13,
                                color: '#334155',
                              }}
                            >
                              {i > 0 ? <span style={{ color: '#94a3b8', margin: '0 6px' }}>·</span> : null}
                              {part}
                            </span>
                          ))
                        )}
                      </div>
                    </Card>
                  </Col>
                )
              })}
            </Row>
          </SkeletonOverlay>
        </>
      ) : (
        <>
          {/* Metric cards - clickable, open detail modal */}
          <Row gutter={[20, 20]} style={{ marginBottom: 28 }}>
            {metricCards.map((card, i) => renderMetricStatCard(card, i, 'm'))}
          </Row>

          <Title level={4} style={{ marginBottom: 16, color: '#1e293b', fontWeight: 600, letterSpacing: 0.5 }}>
            In Staging
          </Title>
          <Row gutter={[20, 20]} style={{ marginBottom: 28 }}>
            {stagingCardsData.map((card, i) => (
              <Col xs={24} sm={12} key={`staging-${i}`}>
                <Card
                  onClick={() => loadDetail(card.metricKey, card.title)}
                  style={{
                    borderRadius: 8,
                    border: '1px solid rgba(0, 0, 0, 0.06)',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
                    background: '#ffffff',
                    borderTop: `3px solid ${card.color}`,
                    cursor: 'pointer',
                  }}
                  bodyStyle={{ padding: 22 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minWidth: 0 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          whiteSpace: 'normal',
                          wordBreak: 'break-word',
                          display: 'block',
                          color: '#64748b',
                        }}
                      >
                        {card.title}
                      </Text>
                      <Statistic
                        value={card.value}
                        valueStyle={{ fontSize: 28, fontWeight: 700, color: card.color }}
                        style={{ marginTop: 4 }}
                      />
                    </div>
                    <div style={{ fontSize: 26, color: card.color, flexShrink: 0 }}>{card.icon}</div>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>

          {paymentActionBlock}
        </>
      )}

      {/* Trends: Recharts in a separate lazy chunk so the dashboard shell loads first */}
      <Suspense
        fallback={
          <Row gutter={[20, 20]}>
            <Col xs={24} lg={12}>
              <Card style={{ minHeight: 280 }} styles={{ body: { padding: 12 } }}>
                <ChartAreaSkeleton height={260} />
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card style={{ minHeight: 280 }} styles={{ body: { padding: 12 } }}>
                <ChartAreaSkeleton height={260} />
              </Card>
            </Col>
          </Row>
        }
      >
        <DashboardTrendCharts trendPoints={trendPoints} />
      </Suspense>

      {/* Active Leads - from Client to Lead (last, after trends) */}
      <Title level={4} style={{ marginBottom: 16, marginTop: 28, color: '#1e293b', fontWeight: 600, letterSpacing: 0.5 }}>
        Active Leads
      </Title>
      <style>{`.dashboard-active-leads .ant-table-thead > tr > th { background: #22c55e !important; color: #fff !important; border-bottom-color: rgba(255,255,255,0.3) !important; font-weight: 600; }`}</style>
      <Card
        className="dashboard-active-leads"
        style={{ marginBottom: 28, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(0, 0, 0, 0.06)', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)' }}
        bodyStyle={{ padding: 0 }}
      >
        <TableWithSkeletonLoading loading={activeLeadsLoading} columns={5} rows={10}>
          <Table
            loading={false}
            dataSource={activeLeads}
            rowKey="id"
            size="small"
            scroll={{ x: 720 }}
            pagination={activeLeads.length > 10 ? { pageSize: 10, showSizeChanger: false, showTotal: (t) => `Total ${t} leads` } : false}
            onRow={(record) => ({
              onClick: () => navigate(ROUTES.LEAD_DETAIL.replace(':id', record.reference_no)),
              style: { cursor: 'pointer' },
            })}
            columns={[
              {
                title: 'Company Name',
                dataIndex: 'company_name',
                key: 'company_name',
                width: 180,
                render: (v: string) => v || '—',
              },
              {
                title: 'Stage',
                dataIndex: 'stage',
                key: 'stage',
                width: 160,
                render: (stage: string) => {
                  const color = ACTIVE_LEAD_STAGE_COLORS[stage] || '#94a3b8'
                  const isLight = ['#86efac', '#bae6fd', '#e0f2fe'].includes(color)
                  return <Tag style={{ margin: 0, border: 'none', background: color, color: isLight ? '#0f172a' : '#fff' }}>{stage || '—'}</Tag>
                },
              },
              {
                title: 'Person Name',
                dataIndex: 'person_name',
                key: 'person_name',
                width: 140,
                render: (v: string) => v || '—',
              },
              {
                title: 'City',
                dataIndex: 'city',
                key: 'city',
                width: 120,
                render: (v: string) => v || '—',
              },
              {
                title: 'State',
                dataIndex: 'state',
                key: 'state',
                width: 120,
                render: (v: string) => v || '—',
              },
            ]}
          />
        </TableWithSkeletonLoading>
      </Card>

      <Modal
        title={successDetailModal ? `${successDetailModal.title} — previous week` : 'Success detail'}
        open={!!successDetailModal}
        onCancel={() => setSuccessDetailModal(null)}
        footer={null}
        width={840}
      >
        {successDetailModal?.rows?.length ? (
          <Table
            dataSource={successDetailModal.rows}
            rowKey={(_, i) => String(i)}
            size="small"
            pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `Total ${t} rows` }}
            scroll={{ x: 920 }}
            columns={successDetailColumns as never}
          />
        ) : (
          <Text type="secondary">No rows found for this metric in the previous week.</Text>
        )}
      </Modal>

      <Modal
        title={
          isPaymentKpiDetail ? (
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <span>{detailTitle}</span>
              <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>
                Same raised-invoice rows as{' '}
                <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => { setDetailModalOpen(false); navigate(ROUTES.CLIENT_PAYMENT) }}>
                  Payment Management
                </Button>
              </Text>
            </Space>
          ) : (
            detailTitle
          )
        }
        open={detailModalOpen}
        onCancel={() => { setDetailModalOpen(false); setDetailData([]) }}
        footer={
          isPaymentKpiDetail ? (
            <Button type="primary" onClick={() => { setDetailModalOpen(false); navigate(ROUTES.CLIENT_PAYMENT) }}>
              Open Payment Management
            </Button>
          ) : null
        }
        width={isPaymentKpiDetail ? 1100 : 800}
      >
        {detailLoading ? (
          <ModalContentSkeleton rows={12} />
        ) : isPaymentKpiDetail ? (
          <Table
            dataSource={detailData}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 100, showSizeChanger: true, showTotal: (t) => `Total ${t} invoices` }}
            scroll={{ x: 1000 }}
            columns={[
              {
                title: 'Reference',
                dataIndex: 'referenceNo',
                key: 'referenceNo',
                width: 130,
                ellipsis: true,
                render: (v: string) => v || '—',
              },
              {
                title: 'Company Name',
                dataIndex: 'company',
                key: 'company',
                width: 220,
                ellipsis: true,
                render: (v: string) => v || '—',
              },
              {
                title: 'Invoice Date',
                dataIndex: 'invoiceDate',
                key: 'invoiceDate',
                width: 120,
                render: (v: string) => (v && dayjs(v).isValid() ? dayjs(v).format('DD-MMM-YYYY') : '—'),
              },
              {
                title: 'Invoice Amount',
                dataIndex: 'invoiceAmount',
                key: 'invoiceAmount',
                width: 120,
                align: 'right' as const,
                render: (v: number | undefined) => (v != null ? `₹${formatINR(Number(v))}` : '—'),
              },
              {
                title: 'Invoice Number',
                dataIndex: 'invoiceNumber',
                key: 'invoiceNumber',
                width: 130,
                ellipsis: true,
                render: (v: string) => v || '—',
              },
              {
                title: 'Stage',
                dataIndex: 'stage',
                key: 'stage',
                width: 150,
                ellipsis: true,
                render: (v: string) => v || '—',
              },
              {
                title: 'Status',
                dataIndex: 'status',
                key: 'status',
                width: 100,
                render: (v: string) => v || '—',
              },
              {
                title: 'Aging (days)',
                dataIndex: 'agingDays',
                key: 'agingDays',
                width: 100,
                align: 'center' as const,
                render: (v: number | null | undefined) => (v != null ? String(v) : '—'),
              },
              {
                title: 'Genre',
                dataIndex: 'genre',
                key: 'genre',
                width: 100,
                render: (v: string) => v || '—',
              },
            ]}
          />
        ) : (
          <>
            {detailMetric === 'custom_pending_delegation' && (
              <Space style={{ marginBottom: 12 }} wrap>
                <Text type="secondary">Delegation On date filter:</Text>
                <DatePicker
                  value={delegationDateFilter}
                  onChange={(d) => setDelegationDateFilter(d)}
                  allowClear
                  format="DD-MMM-YYYY"
                />
              </Space>
            )}
            <Table
            dataSource={filteredDetailData}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `Total ${t} tickets` }}
            scroll={{ x: 'max-content' }}
            columns={[
              ...(!hideCompanyColumnInDelegation
                ? [
                    {
                      title: 'Company',
                      dataIndex: 'company',
                      key: 'company',
                      width: 140,
                      onCell: () => ({ style: { whiteSpace: 'normal', wordBreak: 'break-word' } }),
                    },
                  ]
                : []),
              {
                title: <span style={{ fontWeight: 600 }}>Title & Description</span>,
                key: 'title_description',
                onCell: () => ({ style: { whiteSpace: 'pre-line', wordBreak: 'break-word' } }),
                render: (_: unknown, record: DashboardDetailTicket) => {
                  const wrapAfterWords = (text: string, n: number) =>
                    text.trim().split(/\s+/).filter(Boolean).reduce<string[]>((lines, word, i) => {
                      if (i % n === 0) lines.push(word)
                      else lines[lines.length - 1] += ' ' + word
                      return lines
                    }, []).join('\n')
                  return (
                    <div style={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>
                      {record.title && <div style={{ fontWeight: 600 }}>{wrapAfterWords(record.title, 10)}</div>}
                      {record.description && <div style={{ marginTop: 4, color: '#64748b', fontSize: 13 }}>{wrapAfterWords(record.description, 10)}</div>}
                    </div>
                  )
                },
              },
              {
                title: 'Reference',
                dataIndex: 'referenceNo',
                key: 'referenceNo',
                width: 120,
                onCell: () => ({ style: { whiteSpace: 'normal', wordBreak: 'break-word' } }),
                render: (_: unknown, record: DashboardDetailTicket) => (
                  (record.type || '').toLowerCase() === 'feature' ||
                  (record.type || '').toLowerCase() === 'bug' ||
                  (record.type || '').toLowerCase() === 'chore' ? (
                    <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openTicket(record)}>
                      {record.referenceNo}
                    </Button>
                  ) : (
                    <span>{record.referenceNo}</span>
                  )
                ),
              },
              {
                title: 'Type',
                dataIndex: 'type',
                key: 'type',
                width: 90,
                onCell: () => ({ style: { whiteSpace: 'normal', wordBreak: 'break-word' } }),
              },
              ...(detailMetric === 'custom_pending_delegation'
                ? [
                    {
                      title: 'Delegation On',
                      dataIndex: 'delegationOn',
                      key: 'delegationOn',
                      width: 140,
                      render: (v: string) =>
                        v && dayjs(v).isValid() ? dayjs(v).format('DD-MMM-YYYY') : '—',
                    },
                  ]
                : []),
              {
                title: 'Status',
                dataIndex: 'status',
                key: 'status',
                width: 100,
                onCell: () => ({ style: { whiteSpace: 'normal', wordBreak: 'break-word' } }),
              },
            ]}
            />
          </>
        )}
      </Modal>

      <Modal
        title={
          paymentActionRow?.pending_payment_tag === 't2'
            ? 'Payment Action — Tag T2'
            : paymentActionRow?.pending_payment_tag === 't1'
              ? 'Payment Action — Tag T1'
              : 'Payment Action'
        }
        open={paymentActionModalOpen}
        onCancel={() => {
          setPaymentActionModalOpen(false)
          setPaymentActionRow(null)
          paymentActionForm.resetFields()
        }}
        footer={null}
        destroyOnClose
        width={480}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {paymentActionRow?.company_name || '—'} · {paymentActionRow?.reference_no || '—'}
        </Text>
        <Form
          form={paymentActionForm}
          layout="vertical"
          onFinish={async (values) => {
            if (!paymentActionRow?.client_payment_id) return
            if (paymentActionRow.pending_payment_tag === 'completed') return
            setPaymentActionSubmitting(true)
            try {
              await dashboardApi.submitPaymentAction({
                client_payment_id: paymentActionRow.client_payment_id,
                person: values.person?.trim() || '',
                remarks: values.remarks?.trim() || '',
                tag: paymentActionRow.pending_payment_tag === 't2' ? 't2' : 't1',
              })
              message.success('Saved. This row is cleared from Payment Action and visible under Client Payment.')
              const res = await dashboardApi.getPaymentActions()
              setPaymentActions(res.items || [])
              setPaymentActionModalOpen(false)
              setPaymentActionRow(null)
              paymentActionForm.resetFields()
            } catch (e: unknown) {
              const err = e as { response?: { data?: { detail?: string } } }
              message.error(err?.response?.data?.detail || 'Submit failed')
            } finally {
              setPaymentActionSubmitting(false)
            }
          }}
        >
          <Form.Item name="person" label="Person" rules={[{ required: true, message: 'Enter person name' }]}>
            <Input placeholder="Person" />
          </Form.Item>
          <Form.Item name="remarks" label="Remarks" rules={[{ required: true, message: 'Enter remarks' }]}>
            <Input.TextArea placeholder="Remarks" rows={4} />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Button onClick={() => { setPaymentActionModalOpen(false); setPaymentActionRow(null) }} style={{ marginRight: 8 }}>
              Cancel
            </Button>
            <Button type="primary" htmlType="submit" loading={paymentActionSubmitting}>
              Submit
            </Button>
          </Form.Item>
        </Form>
      </Modal>

    </div>
  )
}
