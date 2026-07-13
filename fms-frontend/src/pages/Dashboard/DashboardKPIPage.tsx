import { useState, useEffect, useCallback, useRef, lazy, Suspense, useMemo } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Typography,
  Card,
  Button,
  Select,
  Row,
  Col,
  Table,
  Progress,
  Tag,
  Space,
  message,
  Modal,
  Alert,
  Tabs,
  Input,
  InputNumber,
  DatePicker,
  Checkbox,
  Spin,
} from 'antd'
import {
  DashboardOutlined,
  ArrowLeftOutlined,
  CheckSquareOutlined,
  SwapOutlined,
  CustomerServiceOutlined,
  UnorderedListOutlined,
  PieChartOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import type { AxiosError } from 'axios'
import './dashboard-kpi.css'
import {
  dashboardKpiApi,
  dashboardKpiCacheKey,
  aggregateChecklistRowsByTask,
  DASHBOARD_KPI_NAMES,
  MONTHS,
  YEARS,
  type DashboardKpiPerson,
  type DashboardKpiResponse,
  type SupportFmsDelayItem,
  type SupportFmsDetailPillar,
  type AkashCustomerSupportBlock,
  type KpiDailyLogApiRow,
  type AdrijaSocialKpiDailyRow,
} from '../../api/dashboardKpi'
import { sessionApiCacheGet } from '../../utils/sessionApiCache'
import { useAuth } from '../../hooks/useAuth'
import type { UserRole } from '../../types/auth'
import { ROUTES } from '../../utils/constants'
import { canViewDashboardKpiPerson, resolveKpiPersonForUser } from '../../utils/dashboardKpiPermissions'
import { useActiveKpiPersons } from '../../hooks/useActiveKpiPersons'
import { ChartAreaSkeleton, DashboardBlockSkeleton, SkeletonOverlay } from '../../components/common/skeletons'
import { SoumyaDashboardView } from './SoumyaDashboardView'
import { SouvikDashboardView } from './SouvikDashboardView'
import {
  buildKpiWeekSelectOptions,
  getDefaultPreviousWeekFilter,
  getKpiCalendarWeekBounds,
  getKpiCanonicalWeekSelection,
  listKpiWeekIndicesForMonth,
  weekOfMonth,
} from './kpiWeekUtils'

function kpiDailyLogErrorDetail(err: unknown, fallback: string): string {
  const ax = err as AxiosError<{ detail?: string | Array<{ msg?: string }> }>
  const d = ax.response?.data?.detail
  if (typeof d === 'string' && d.trim()) return d.trim().slice(0, 500)
  if (Array.isArray(d) && d.length)
    return d
      .map((x) => (typeof x === 'object' && x && 'msg' in x ? String((x as { msg?: string }).msg) : JSON.stringify(x)))
      .join('; ')
      .slice(0, 500)
  return fallback
}

const LazyWeeklyBarChart = lazy(() => import('./DashboardKPIWeeklyBarChart'))
const LazyAkashMonthlyBarChart = lazy(() => import('./DashboardKPIAkashMonthlyBarChart'))

const { Title, Text } = Typography

interface DashboardKPIPageProps {
  /** Open dashboard directly without dashboard chooser cards. */
  forceOpen?: boolean
  /** Default person when forceOpen is enabled. */
  defaultPerson?: DashboardKpiPerson
}

const DASHBOARD_OPTIONS: { key: DashboardKpiPerson; label: string }[] = [
  { key: 'Shreyasi', label: 'Shreyasi Dashboard' },
  { key: 'Rimpa', label: 'Rimpa Dashboard' },
  { key: 'Akash', label: 'Akash Dashboard' },
  { key: 'Adrija', label: 'Adrija Dashboard' },
  { key: 'Soumya', label: 'Soumya Dashboard' },
  { key: 'Souvik', label: 'Souvik Dashboard' },
]

/** Success KPI (Performance Monitoring aggregates) — Rimpa only. */
const usesSuccessKpiSection = (person: DashboardKpiPerson | null) => person === 'Rimpa'

const showsStandardSupportFms = (person: DashboardKpiPerson | null) =>
  person === 'Shreyasi' || person === 'Soumya'

const ADRIJA_SOCIAL_KPI_EDITOR_EMAILS = new Set(['adrija@industryprime.com', 'aman@industryprime.com'])

const ADRIJA_KPI_TASK_LABEL: Record<'post' | 'reel' | 'linkedin', string> = {
  post: '1 Post Every Week',
  reel: '1 Reel Every Week',
  linkedin: '1 LinkedIn Post Every Week',
}

/** Pastel inner cards for Akash KPI pillars — same classes as Rimpa Success KPI */
const AKASH_KPI_PILLAR_CARD_CLASS: Record<string, string> = {
  item_cleaning: 'kpi-success-card--poc',
  customer_support: 'kpi-success-card--training',
  bulk_upload: 'kpi-success-card--bulk',
  video_content: 'kpi-success-card--followup',
  ai_learning: 'kpi-success-card--increase',
}

/** Format ISO date/time as 'YYYY-MM-DD hh:mm AM/PM' for Query Arrival display */
const formatQueryArrival = (val: string | null | undefined): string => {
  if (!val) return '—'
  const d = dayjs(val)
  return d.isValid() ? d.format('YYYY-MM-DD hh:mm A') : String(val)
}

/** Table columns for Akash Customer Support ticket lists (tabs modal) */
const AKASH_CS_TABLE_COLUMNS = [
  { title: 'Ref', dataIndex: 'reference_no', key: 'reference_no', width: 100 },
  { title: 'Type', dataIndex: 'type', key: 'type', width: 80 },
  {
    title: 'Company',
    dataIndex: 'company',
    key: 'company',
    width: 140,
    ellipsis: false,
    render: (val: string) => (
      <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', display: 'block' }}>{val ?? '—'}</span>
    ),
  },
  {
    title: 'Submitted by',
    dataIndex: 'submitted_by',
    key: 'submitted_by',
    width: 110,
    ellipsis: true,
    render: (v: string) => v ?? '—',
  },
  {
    title: 'Status',
    dataIndex: 'ticket_status',
    key: 'ticket_status',
    width: 110,
    ellipsis: true,
    render: (v: string) => v ?? '—',
  },
  {
    title: 'Title & Description',
    key: 'title_description',
    width: 240,
    ellipsis: true,
    render: (_: unknown, record: SupportFmsDelayItem) => (
      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        <span style={{ fontWeight: 600 }}>{record.title ?? '—'}</span>
        {record.description ? (
          <>
            <br />
            <span style={{ fontWeight: 400 }}>{record.description}</span>
          </>
        ) : null}
      </div>
    ),
  },
  {
    title: 'Query Arrival',
    dataIndex: 'query_arrival',
    key: 'query_arrival',
    width: 140,
    render: (v: string) => formatQueryArrival(v),
  },
  {
    title: 'Note',
    dataIndex: 'delay_time',
    key: 'delay_note',
    width: 130,
    render: (v: string) => v ?? '—',
  },
]

type KpiDailyLogTableRow = KpiDailyLogApiRow & { dayName: string }

/** Entire calendar month ended before today (local) — log hidden until user picks a month in the modal. */
const isKpiLogMonthCompleted = (m: Dayjs) => m.endOf('month').isBefore(dayjs(), 'day')

const getPerformanceLevel = (value?: number) => {
  const pct = typeof value === 'number' ? value : 0
  if (pct >= 80) {
    return { label: 'High', background: 'rgba(40,167,69,0.15)', color: '#28A745' }
  }
  if (pct >= 50) {
    return { label: 'Medium', background: 'rgba(255,193,7,0.15)', color: '#FFC107' }
  }
  return { label: 'Low', background: 'rgba(220,53,69,0.15)', color: '#DC3545' }
}

const isCancelledDelegationKpiRow = (status?: string) => {
  const v = (status || '').toLowerCase().trim()
  return v === 'cancelled' || v === 'cancel' || v === 'canceled'
}

export const DashboardKPIPage = ({ forceOpen = false, defaultPerson }: DashboardKPIPageProps) => {
  const { user } = useAuth()
  const activeKpiPersons = useActiveKpiPersons()
  const userRole = (user?.role ?? 'user') as UserRole
  const sectionPermissions = user?.section_permissions
  const visibleDashboardOptions = useMemo(
    () =>
      DASHBOARD_OPTIONS.filter((opt) =>
        canViewDashboardKpiPerson(opt.key, userRole, sectionPermissions, activeKpiPersons),
      ),
    [userRole, sectionPermissions, activeKpiPersons],
  )
  const resolvedForcePerson = useMemo(
    () =>
      forceOpen
        ? resolveKpiPersonForUser(
            userRole,
            sectionPermissions,
            user?.email,
            user?.full_name || user?.display_name,
            defaultPerson ?? null,
            activeKpiPersons,
          )
        : null,
    [forceOpen, defaultPerson, userRole, sectionPermissions, user?.email, user?.full_name, user?.display_name, activeKpiPersons],
  )
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const previousWeekDefaults = getDefaultPreviousWeekFilter()
  const [selectedPerson, setSelectedPerson] = useState<DashboardKpiPerson | null>(() =>
    forceOpen ? resolvedForcePerson : null,
  )
  const [month, setMonth] = useState<string>(MONTHS[previousWeekDefaults.monthIndex] ?? MONTHS[dayjs().month()])
  const [year, setYear] = useState<string>(previousWeekDefaults.year || String(dayjs().year()))
  const [week, setWeek] = useState<string>(`week ${previousWeekDefaults.week}`)
  const [data, setData] = useState<DashboardKpiResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [detailModal, setDetailModal] = useState<{
    title: string
    items: SupportFmsDelayItem[]
    loading: boolean
  } | null>(null)
  const [akashCsModal, setAkashCsModal] = useState<AkashCustomerSupportBlock | null>(null)
  const [successModal, setSuccessModal] = useState<
    | null
    | {
        type: 'poc' | 'training' | 'followup' | 'increase'
        title: string
      }
  >(null)
  const [graphModal, setGraphModal] = useState<
    'checklist' | 'delegation' | 'supportFMS' | 'successKpi' | 'akashMonthly' | null
  >(null)
  const [adrijaSocialModalOpen, setAdrijaSocialModalOpen] = useState(false)
  const [adrijaSocialLogMonth, setAdrijaSocialLogMonth] = useState<Dayjs | null>(null)
  const [adrijaSocialDailyRows, setAdrijaSocialDailyRows] = useState<AdrijaSocialKpiDailyRow[]>([])
  const [adrijaSocialDailyLoading, setAdrijaSocialDailyLoading] = useState(false)
  const [adrijaSocialSaving, setAdrijaSocialSaving] = useState(false)
  const adrijaSocialDailyDirtyRef = useRef<Set<string>>(new Set())
  const adrijaSocialDailyRowsRef = useRef<AdrijaSocialKpiDailyRow[]>([])
  adrijaSocialDailyRowsRef.current = adrijaSocialDailyRows

  const [adrijaPillarDetail, setAdrijaPillarDetail] = useState<'post' | 'reel' | 'linkedin' | null>(null)
  const [adrijaMonthlySummaryOpen, setAdrijaMonthlySummaryOpen] = useState(false)
  /** Souvik EA KPI monthly % = average weekly composite (×10) for the selected month. */
  const [souvikMonthlyPercent, setSouvikMonthlyPercent] = useState<number | null>(null)

  const [kpiDailyLogOpen, setKpiDailyLogOpen] = useState(false)
  const [kpiDailyLogMonth, setKpiDailyLogMonth] = useState<Dayjs | null>(null)
  /** When false, completed (past) months stay hidden until the user changes the month filter. */
  const [kpiDailyLogTableVisible, setKpiDailyLogTableVisible] = useState(true)
  const [kpiDailyLogRows, setKpiDailyLogRows] = useState<KpiDailyLogTableRow[]>([])
  const [kpiDailyLogLoading, setKpiDailyLogLoading] = useState(false)
  const kpiDailyLogDirtyRef = useRef<Set<string>>(new Set())
  const kpiDailyLogRowsRef = useRef<KpiDailyLogTableRow[]>([])
  kpiDailyLogRowsRef.current = kpiDailyLogRows

  const loadKpiDailyLogMonth = useCallback(async () => {
    if (!kpiDailyLogMonth) return
    const y = kpiDailyLogMonth.year()
    const mi = kpiDailyLogMonth.month()
    setKpiDailyLogLoading(true)
    try {
      const res = await dashboardKpiApi.getKpiDailyLog(y, mi + 1)
      const byDate = new Map((res.rows ?? []).map((r) => [r.work_date, r]))
      const base = kpiDailyLogMonth.date(1)
      const n = base.daysInMonth()
      const next: KpiDailyLogTableRow[] = []
      for (let d = 1; d <= n; d += 1) {
        const dj = base.date(d)
        const iso = dj.format('YYYY-MM-DD')
        const ex = byDate.get(iso)
        next.push({
          work_date: iso,
          dayName: dj.format('dddd'),
          items_cleaned: ex?.items_cleaned ?? null,
          errors_found: ex?.errors_found ?? null,
          accuracy_pct: ex?.accuracy_pct ?? null,
          videos_created: ex?.videos_created ?? null,
          video_type: ex?.video_type ?? null,
          bulk_upload_tickets: ex?.bulk_upload_tickets ?? null,
          ai_tasks_used: ex?.ai_tasks_used ?? null,
          process_improved: ex?.process_improved ?? null,
        })
      }
      setKpiDailyLogRows(next)
      kpiDailyLogDirtyRef.current = new Set()
    } catch (e) {
      message.error(kpiDailyLogErrorDetail(e, 'Failed to load KPI daily work log'))
    } finally {
      setKpiDailyLogLoading(false)
    }
  }, [kpiDailyLogMonth])

  const openKpiDailyLog = useCallback(() => {
    const y = Number(year)
    const mi = MONTHS.indexOf(month as (typeof MONTHS)[number])
    if (!Number.isFinite(y) || mi < 0) {
      message.error('Pick month and year on the dashboard first')
      return
    }
    const m = dayjs().year(y).month(mi).date(1)
    setKpiDailyLogMonth(m)
    const completed = isKpiLogMonthCompleted(m)
    setKpiDailyLogTableVisible(!completed)
    if (completed) {
      setKpiDailyLogRows([])
      kpiDailyLogDirtyRef.current = new Set()
    }
    setKpiDailyLogOpen(true)
  }, [month, year])

  useEffect(() => {
    if (!kpiDailyLogOpen || !kpiDailyLogMonth || !kpiDailyLogTableVisible) return
    void loadKpiDailyLogMonth()
  }, [kpiDailyLogOpen, kpiDailyLogMonth, kpiDailyLogTableVisible, loadKpiDailyLogMonth])

  const patchKpiDailyLogRow = (workDate: string, patch: Partial<KpiDailyLogApiRow>) => {
    kpiDailyLogDirtyRef.current.add(workDate)
    setKpiDailyLogRows((rows) => rows.map((r) => (r.work_date === workDate ? { ...r, ...patch } : r)))
  }

  const saveKpiDailyLogChanges = async () => {
    if (!kpiDailyLogTableVisible) {
      message.info('Choose a month in the date filter to show the log before saving.')
      return
    }
    const dirty = new Set(kpiDailyLogDirtyRef.current)
    if (dirty.size === 0) {
      message.info('No changes to save')
      return
    }
    try {
      for (const wd of dirty) {
        const r = kpiDailyLogRowsRef.current.find((x) => x.work_date === wd)
        if (!r) continue
        await dashboardKpiApi.putKpiDailyLog({
          work_date: r.work_date,
          items_cleaned: r.items_cleaned ?? null,
          errors_found: r.errors_found ?? null,
          accuracy_pct: r.accuracy_pct ?? null,
          videos_created: r.videos_created ?? null,
          video_type: r.video_type?.trim() || null,
          bulk_upload_tickets: r.bulk_upload_tickets ?? null,
          ai_tasks_used: r.ai_tasks_used ?? null,
          process_improved: r.process_improved ?? null,
        })
      }
      kpiDailyLogDirtyRef.current.clear()
      message.success('KPI daily log saved')
      loadData()
    } catch (e) {
      message.error(kpiDailyLogErrorDetail(e, 'Could not save KPI daily log'))
      throw new Error('save failed')
    }
  }

  // Trailing merged weeks → next month week 1; clamp week to selectable slots for this month.
  useEffect(() => {
    const canonical = getKpiCanonicalWeekSelection(month, year, week, MONTHS)
    if (canonical) {
      setMonth(canonical.month)
      setYear(canonical.year)
      setWeek(canonical.week)
      return
    }
    const monthIndex = MONTHS.findIndex((m) => m === month)
    if (monthIndex < 0) return
    const y = Number(year)
    if (!Number.isFinite(y)) return
    const parsed = Number((week || '').replace(/[^\d]/g, '')) || weekOfMonth(dayjs())
    const selectable = listKpiWeekIndicesForMonth(y, monthIndex)
    const maxSelectable = selectable[selectable.length - 1] ?? 1
    if (parsed > maxSelectable) setWeek(`week ${maxSelectable}`)
  }, [month, year, week])

  const loadData = useCallback(() => {
    if (!selectedPerson) return
    const filters = { name: selectedPerson, month, year, week }
    const cached = sessionApiCacheGet<DashboardKpiResponse>(dashboardKpiCacheKey(filters))
    if (cached && cached.success !== false) {
      setData(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }
    dashboardKpiApi
      .getData(filters)
      .then((res) => {
        if (res && res.success !== false) setData(res)
        else {
          message.error(res?.error || 'Failed to load dashboard data')
          setData(res?.success === false ? res : null)
        }
      })
      .catch((e: unknown) => {
        if (!cached) {
          const err = e as { response?: { data?: { detail?: string } } }
          const detail = err?.response?.data?.detail
          message.error(
            typeof detail === 'string' ? detail : 'Failed to load dashboard data',
          )
          setData(null)
        }
      })
      .finally(() => setLoading(false))
  }, [selectedPerson, month, year, week])

  useEffect(() => {
    if (selectedPerson !== 'Souvik') {
      setSouvikMonthlyPercent(null)
      return
    }
    const monthIdx = MONTHS.findIndex((m) => m === month)
    const yearNum = Number(year)
    if (monthIdx < 0 || !Number.isFinite(yearNum)) return
    const first = dayjs().year(yearNum).month(monthIdx).date(1)
    const dow = first.day()
    const startMonday = first.add(dow === 0 ? -6 : 1 - dow, 'day').format('YYYY-MM-DD')
    let cancelled = false
    void dashboardKpiApi
      .getSouvikWeeklyLog(startMonday, 6)
      .then((res) => {
        if (cancelled) return
        const composites = (res.rows ?? [])
          .filter(
            (r) =>
              r.has_data &&
              r.composite_score != null &&
              dayjs(r.week_from).month() === monthIdx &&
              dayjs(r.week_from).year() === yearNum,
          )
          .map((r) => r.composite_score as number)
        if (composites.length === 0) {
          setSouvikMonthlyPercent(0)
          return
        }
        const avg = composites.reduce((a, b) => a + b, 0) / composites.length
        setSouvikMonthlyPercent(Math.round(Math.min(100, Math.max(0, avg * 10))))
      })
      .catch(() => {
        if (!cancelled) setSouvikMonthlyPercent(0)
      })
    return () => {
      cancelled = true
    }
  }, [selectedPerson, month, year])

  const openSupportFmsDetail = useCallback(
    async (pillar: SupportFmsDetailPillar, title: string) => {
      if (!selectedPerson) return
      const filters = { name: selectedPerson, month, year, week }
      setDetailModal({ title, items: [], loading: true })
      try {
        const res = await dashboardKpiApi.getSupportFmsDetails(filters, pillar)
        if (res?.success === false) {
          message.error(
            (res as { error?: string }).error || 'Failed to load Support FMS list',
          )
        }
        setDetailModal({
          title,
          items: res?.items ?? [],
          loading: false,
        })
      } catch (e) {
        message.error(kpiDailyLogErrorDetail(e, 'Failed to load Support FMS list'))
        setDetailModal({ title, items: [], loading: false })
      }
    },
    [selectedPerson, month, year, week],
  )

  const loadAdrijaSocialMonth = useCallback(async () => {
    if (!adrijaSocialLogMonth) return
    setAdrijaSocialDailyLoading(true)
    try {
      const y = adrijaSocialLogMonth.year()
      const m = adrijaSocialLogMonth.month() + 1
      const res = await dashboardKpiApi.getAdrijaSocialKpiDaily(y, m)
      setAdrijaSocialDailyRows(res.rows ?? [])
      adrijaSocialDailyDirtyRef.current = new Set()
    } catch (e) {
      message.error(kpiDailyLogErrorDetail(e, 'Failed to load Adrija KPI log'))
    } finally {
      setAdrijaSocialDailyLoading(false)
    }
  }, [adrijaSocialLogMonth])

  const openAdrijaSocialModal = useCallback(() => {
    const y = Number(year)
    const mi = MONTHS.indexOf(month as (typeof MONTHS)[number])
    if (!Number.isFinite(y) || mi < 0) {
      message.error('Pick month and year on the dashboard first')
      return
    }
    setAdrijaSocialLogMonth(dayjs().year(y).month(mi).date(1))
    setAdrijaSocialModalOpen(true)
  }, [month, year])

  useEffect(() => {
    if (!adrijaSocialModalOpen || !adrijaSocialLogMonth) return
    void loadAdrijaSocialMonth()
  }, [adrijaSocialModalOpen, adrijaSocialLogMonth, loadAdrijaSocialMonth])

  const patchAdrijaSocialDailyRow = (workDate: string, patch: Partial<AdrijaSocialKpiDailyRow>) => {
    adrijaSocialDailyDirtyRef.current.add(workDate)
    setAdrijaSocialDailyRows((rows) => rows.map((r) => (r.work_date === workDate ? { ...r, ...patch } : r)))
  }

  const saveAdrijaSocialDaily = useCallback(async () => {
    const dirty = [...adrijaSocialDailyDirtyRef.current]
    if (dirty.length === 0) {
      message.info('No changes to save')
      return
    }
    setAdrijaSocialSaving(true)
    try {
      const rows = dirty
        .map((wd) => adrijaSocialDailyRowsRef.current.find((x) => x.work_date === wd))
        .filter((r): r is AdrijaSocialKpiDailyRow => !!r)
        .map((r) => ({
          work_date: r.work_date,
          post: r.post ? 1 : 0,
          reel: r.reel ? 1 : 0,
          linkedin: r.linkedin ? 1 : 0,
          post_task_name: (r.post_task_name || '').trim() || undefined,
          reel_task_name: (r.reel_task_name || '').trim() || undefined,
          linkedin_task_name: (r.linkedin_task_name || '').trim() || undefined,
        }))
      for (const r of rows) {
        if (r.post === 1 && !r.post_task_name) {
          message.error(`Post task name required on ${dayjs(r.work_date).format('DD-MMM-YY')}`)
          setAdrijaSocialSaving(false)
          return
        }
        if (r.reel === 1 && !r.reel_task_name) {
          message.error(`Reel task name required on ${dayjs(r.work_date).format('DD-MMM-YY')}`)
          setAdrijaSocialSaving(false)
          return
        }
        if (r.linkedin === 1 && !r.linkedin_task_name) {
          message.error(`LinkedIn task name required on ${dayjs(r.work_date).format('DD-MMM-YY')}`)
          setAdrijaSocialSaving(false)
          return
        }
      }
      await dashboardKpiApi.putAdrijaSocialKpiDaily(rows)
      adrijaSocialDailyDirtyRef.current.clear()
      message.success('Adrija KPI log saved')
      setAdrijaSocialModalOpen(false)
      loadData()
    } catch (e) {
      message.error(kpiDailyLogErrorDetail(e, 'Could not save Adrija KPI log'))
    } finally {
      setAdrijaSocialSaving(false)
    }
  }, [loadData])

  useEffect(() => {
    if (selectedPerson) loadData()
    else setData(null)
  }, [selectedPerson, loadData])

  /** Deep-link from main Dashboard (e.g. ?person=Shreyasi). */
  useEffect(() => {
    if (!forceOpen || !resolvedForcePerson) return
    setSelectedPerson((cur) => {
      if (cur && canViewDashboardKpiPerson(cur, userRole, sectionPermissions, activeKpiPersons)) return cur
      return resolvedForcePerson
    })
  }, [forceOpen, resolvedForcePerson, userRole, sectionPermissions, activeKpiPersons])

  useEffect(() => {
    if (forceOpen) return
    const raw = searchParams.get('person')?.trim()
    if (!raw) return
    const match = DASHBOARD_KPI_NAMES.find((n) => n.toLowerCase() === raw.toLowerCase())
    if (match && canViewDashboardKpiPerson(match, userRole, sectionPermissions, activeKpiPersons)) {
      setSelectedPerson(match)
    }
  }, [forceOpen, searchParams, userRole, sectionPermissions, activeKpiPersons])

  useEffect(() => {
    if (!selectedPerson) return
    if (canViewDashboardKpiPerson(selectedPerson, userRole, sectionPermissions, activeKpiPersons)) return
    if (forceOpen) {
      const fallback = resolveKpiPersonForUser(
        userRole,
        sectionPermissions,
        user?.email,
        user?.full_name || user?.display_name,
        defaultPerson ?? null,
        activeKpiPersons,
      )
      if (fallback) {
        setSelectedPerson(fallback)
        return
      }
      return
    }
    setSelectedPerson(null)
    setSearchParams({}, { replace: true })
  }, [selectedPerson, userRole, sectionPermissions, setSearchParams, forceOpen, user?.email, user?.full_name, user?.display_name, defaultPerson, activeKpiPersons])

  useEffect(() => {
    if (selectedPerson !== 'Adrija') {
      setAdrijaSocialModalOpen(false)
      setAdrijaPillarDetail(null)
      setAdrijaMonthlySummaryOpen(false)
    }
  }, [selectedPerson])

  const handleBackToDashboard = useCallback(() => {
    const restoreY = (location.state as { restoreScrollY?: number } | null)?.restoreScrollY
    navigate(ROUTES.DASHBOARD, {
      state:
        typeof restoreY === 'number' && Number.isFinite(restoreY)
          ? { restoreScrollY: restoreY }
          : undefined,
    })
  }, [location.state, navigate])

  const checklistRows = useMemo(
    () => aggregateChecklistRowsByTask(data?.checklist?.rows),
    [data?.checklist?.rows],
  )

  // List view: dashboard chooser cards
  if (!forceOpen && selectedPerson === null) {
    return (
      <div className="dashboard-kpi-page dashboard-kpi-page--futuristic">
        <div className="dashboard-kpi-hero">
          <div className="dashboard-kpi-hero-content">
            <div className="dashboard-kpi-hero-icon">
              <DashboardOutlined />
            </div>
            <div>
              <Title level={3} className="dashboard-kpi-title page-main-heading">
                Dashboard - KPI
              </Title>
              <Text className="dashboard-kpi-subtitle">
                Track Checklist, Delegation, Support FMS, Success KPI, and Soumya SLA metrics across team dashboards.
              </Text>
            </div>
          </div>
        </div>

        {visibleDashboardOptions.length === 0 ? (
          <Alert
            type="warning"
            showIcon
            message="No dashboard access"
            description="You do not have permission to view any KPI dashboards. Contact an administrator."
          />
        ) : null}
        <Row gutter={[24, 24]} className="dashboard-kpi-grid">
          {visibleDashboardOptions.map((opt) => (
            <Col key={opt.key} xs={24} sm={12} md={12} lg={8} xl={8}>
              <Card
                hoverable
                onClick={() => {
                  setSelectedPerson(opt.key)
                  setSearchParams({ person: opt.key }, { replace: true })
                }}
                className={`kpi-card kpi-card--${String(opt.key).toLowerCase()}`}
                style={{ cursor: 'pointer', textAlign: 'left', minHeight: 160 }}
              >
                <div className="kpi-card-header">
                  <div className="kpi-card-icon">
                    <DashboardOutlined />
                  </div>
                  <div>
                    <Title level={5} style={{ margin: 0 }}>
                      {opt.label}
                    </Title>
                    <Text type="secondary">Open detailed KPIs for this dashboard</Text>
                  </div>
                </div>
                <div className="kpi-card-footer">
                  <Text className="kpi-card-pill">View KPI details</Text>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      </div>
    )
  }

  // Data view for selected person
  const monthly = data?.monthlyPercentages
  const checklist = data?.checklist
  const delegation = data?.delegation
  const supportFMS = data?.supportFMS
  const successKpi = data?.successKpi
  const akashKpi = data?.akashKpi
  const isAkashLayout = selectedPerson === 'Akash' && akashKpi != null
  const adrijaSocial = data?.adrijaSocialKpi
  const canEditAdrijaSocial =
    selectedPerson === 'Adrija' &&
    ADRIJA_SOCIAL_KPI_EDITOR_EMAILS.has((user?.email || '').trim().toLowerCase())

  const personAllowed =
    selectedPerson != null &&
    canViewDashboardKpiPerson(selectedPerson, userRole, sectionPermissions, activeKpiPersons)

  if (selectedPerson && !personAllowed) {
    return (
      <div className="dashboard-kpi-page dashboard-kpi-page--futuristic">
        <Alert
          type="warning"
          showIcon
          message="Access denied"
          description="You do not have permission to view this KPI dashboard."
          action={
            !forceOpen ? (
              <Button size="small" onClick={() => setSelectedPerson(null)}>
                Back
              </Button>
            ) : undefined
          }
        />
      </div>
    )
  }

  if (forceOpen && !selectedPerson) {
    return (
      <div className="dashboard-kpi-page dashboard-kpi-page--futuristic">
        <Alert
          type="warning"
          showIcon
          message="No KPI dashboard access"
          description="Your account is not assigned to a KPI dashboard. Contact a Master Admin to grant Rimpa Dashboard (or the relevant person dashboard) under Users → Section permissions."
        />
      </div>
    )
  }

  const monthIndexSel = MONTHS.findIndex((m) => m === month)
  const yearNum = Number(year)
  const weekNumDisplay = Number((week || '').replace(/[^\d]/g, '')) || 1
  const weekOptions =
    monthIndexSel >= 0 && Number.isFinite(yearNum)
      ? buildKpiWeekSelectOptions(yearNum, monthIndexSel)
      : [{ label: 'week 1', value: 'week 1' }]
  const weekMerge = data?.meta?.weekCalendar
  const localBounds =
    monthIndexSel >= 0 && Number.isFinite(yearNum)
      ? getKpiCalendarWeekBounds(yearNum, monthIndexSel, weekNumDisplay)
      : null
  const weekRangeText =
    weekMerge?.startDate && weekMerge?.endDate
      ? `${weekMerge.startDate} → ${weekMerge.endDate}`
      : localBounds
        ? `${localBounds.start.format('D MMM')} – ${localBounds.end.format('D MMM YYYY')}`
        : ''

  return (
    <div className="dashboard-kpi-page dashboard-kpi-page--futuristic">
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {!forceOpen && (
          <Space wrap>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={handleBackToDashboard}
            >
              Back to Dashboard
            </Button>
          </Space>
        )}

        <div className="dashboard-kpi-detail-bar">
          <Title level={4} className="dashboard-kpi-detail-title page-main-heading">
            {selectedPerson} Dashboard
          </Title>
          <Space wrap>
            {selectedPerson === 'Akash' && akashKpi?.kpiDailyLogEditor && (
              <Button type="primary" className="kpi-futuristic-btn-primary" icon={<PlusOutlined />} onClick={openKpiDailyLog}>
                Add KPI
              </Button>
            )}
            {canEditAdrijaSocial && (
              <Button type="primary" className="kpi-futuristic-btn-primary" icon={<PlusOutlined />} onClick={openAdrijaSocialModal}>
                Add
              </Button>
            )}
          </Space>
        </div>

        <div className="dashboard-kpi-filters">
          <span className="dashboard-kpi-filter-field">
            <Text className="dashboard-kpi-filter-label">Month</Text>
            <Select
              value={month}
              onChange={setMonth}
              options={MONTHS.map((m) => ({ label: m, value: m }))}
              className="dashboard-kpi-filter-select"
              popupClassName="dashboard-kpi-select-dropdown"
            />
          </span>
          <span className="dashboard-kpi-filter-field">
            <Text className="dashboard-kpi-filter-label">Year</Text>
            <Select
              value={year}
              onChange={setYear}
              options={YEARS.map((y) => ({ label: y, value: y }))}
              className="dashboard-kpi-filter-select"
              popupClassName="dashboard-kpi-select-dropdown"
            />
          </span>
          <span className="dashboard-kpi-filter-field">
            <Text className="dashboard-kpi-filter-label">Week</Text>
            <Select
              value={week}
              onChange={setWeek}
              options={weekOptions}
              className="dashboard-kpi-filter-select dashboard-kpi-filter-select--week"
              popupClassName="dashboard-kpi-select-dropdown"
              title={
                weekRangeText ||
                'Monday–Sunday calendar week (ISO-style weeks anchored to the 1st of the month).'
              }
            />
          </span>
        </div>

        {selectedPerson && weekRangeText ? (
          <Text className="dashboard-kpi-merge-hint">Calendar week: {weekRangeText}</Text>
        ) : null}

        {loading && <DashboardBlockSkeleton />}

        {loading && showsStandardSupportFms(selectedPerson) && !supportFMS && (
          <Card className="kpi-section-card kpi-section-card--support-fms" style={{ marginTop: 16 }}>
            <Row gutter={[16, 16]}>
              {(['Response Delay', 'Completion Delay', 'Pending Chores & Bugs'] as const).map((label) => (
                <Col xs={24} md={8} key={label}>
                  <Card size="small" title={label} className="kpi-support-card">
                    <div style={{ minHeight: 72, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Spin tip="Loading Support FMS…" />
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          </Card>
        )}

        {!loading && data && data.success !== false && (
          <>
            {/* Monthly KPI summary – click to show weekly % graph */}
            {monthly && (
              <Row gutter={[16, 16]}>
                <Col xs={24} sm={24} md={8}>
                  <Card
                    size="small"
                    title="Checklist (Monthly %)"
                    className="kpi-summary-card kpi-summary-card--checklist kpi-summary-card--clickable"
                    style={{ borderTop: '3px solid #60A5FA', cursor: 'pointer' }}
                    onClick={() => setGraphModal('checklist')}
                  >
                    <Space direction="vertical" align="center">
                      <Progress type="circle" percent={monthly.checklist ?? 0} size={80} strokeColor="#60A5FA" />
                      <div
                        className="kpi-performance-pill"
                        style={getPerformanceLevel(monthly.checklist)}
                      >
                        {getPerformanceLevel(monthly.checklist).label} Performance
                      </div>
                      <Text type="secondary" style={{ fontSize: 12 }}>Click to see weekly %</Text>
                    </Space>
                  </Card>
                </Col>
                <Col xs={24} sm={24} md={8}>
                  <Card
                    size="small"
                    title="Delegation (Monthly %)"
                    className="kpi-summary-card kpi-summary-card--delegation kpi-summary-card--clickable"
                    style={{ borderTop: '3px solid #28A745', cursor: 'pointer' }}
                    onClick={() => setGraphModal('delegation')}
                  >
                    <Space direction="vertical" align="center">
                      <Progress type="circle" percent={monthly.delegation ?? 0} size={80} strokeColor="#28A745" />
                      <div
                        className="kpi-performance-pill"
                        style={getPerformanceLevel(monthly.delegation)}
                      >
                        {getPerformanceLevel(monthly.delegation).label} Performance
                      </div>
                      <Text type="secondary" style={{ fontSize: 12 }}>Click to see weekly %</Text>
                    </Space>
                  </Card>
                </Col>
                {selectedPerson === 'Souvik' && (
                  <Col xs={24} sm={24} md={8}>
                    <Card
                      size="small"
                      title="KPI (Monthly %)"
                      className="kpi-summary-card kpi-summary-card--akash-overall"
                      style={{ borderTop: '3px solid #7c3aed' }}
                    >
                      <Space direction="vertical" align="center">
                        <Progress
                          type="circle"
                          percent={souvikMonthlyPercent ?? 0}
                          size={80}
                          strokeColor="#7c3aed"
                        />
                        <div
                          className="kpi-performance-pill"
                          style={getPerformanceLevel(souvikMonthlyPercent ?? 0)}
                        >
                          {getPerformanceLevel(souvikMonthlyPercent ?? 0).label} Performance
                        </div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          EA composite average for {month} {year}
                        </Text>
                      </Space>
                    </Card>
                  </Col>
                )}
                {selectedPerson === 'Adrija' && adrijaSocial != null && (
                  <Col xs={24} sm={24} md={8}>
                    <Card
                      size="small"
                      title="KPI (Monthly %)"
                      className="kpi-summary-card kpi-summary-card--akash-overall kpi-summary-card--clickable"
                      style={{ borderTop: '3px solid #7c3aed', cursor: 'pointer' }}
                      onClick={() => setAdrijaMonthlySummaryOpen(true)}
                    >
                      <Space direction="vertical" align="center">
                        <Progress
                          type="circle"
                          percent={adrijaSocial.monthlyPercent ?? 0}
                          size={80}
                          strokeColor="#7c3aed"
                        />
                        <div
                          className="kpi-performance-pill"
                          style={getPerformanceLevel(adrijaSocial.monthlyPercent ?? 0)}
                        >
                          {getPerformanceLevel(adrijaSocial.monthlyPercent ?? 0).label} Performance
                        </div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          Post, Reel and LinkedIn marked in {month} {year}
                        </Text>
                      </Space>
                    </Card>
                  </Col>
                )}
                {showsStandardSupportFms(selectedPerson) && (
                <Col xs={24} sm={24} md={8}>
                  <Card
                    size="small"
                    title="Support FMS (Monthly %)"
                    className="kpi-summary-card kpi-summary-card--support kpi-summary-card--clickable"
                    style={{ borderTop: '3px solid #FFC107', cursor: 'pointer' }}
                    onClick={() => setGraphModal('supportFMS')}
                  >
                    <Space direction="vertical" align="center">
                      <Progress type="circle" percent={monthly.supportFMS ?? 0} size={80} strokeColor="#FFC107" />
                      <div
                        className="kpi-performance-pill"
                        style={getPerformanceLevel(monthly.supportFMS)}
                      >
                        {getPerformanceLevel(monthly.supportFMS).label} Performance
                      </div>
                      <Text type="secondary" style={{ fontSize: 12 }}>Click to see weekly %</Text>
                    </Space>
                  </Card>
                </Col>
                )}
                {selectedPerson === 'Akash' && akashKpi != null && (
                  <Col xs={24} sm={24} md={8}>
                    <Card
                      size="small"
                      title="KPI Monthly"
                      className="kpi-summary-card kpi-summary-card--akash-overall kpi-summary-card--clickable"
                      style={{ borderTop: '3px solid #0d9488', cursor: 'pointer' }}
                      onClick={() => setGraphModal('akashMonthly')}
                    >
                      <Space direction="vertical" align="center">
                        <Progress
                          type="circle"
                          percent={akashKpi.overall_score_monthly_percent ?? akashKpi.overall_score_percent ?? 0}
                          size={80}
                          strokeColor="#0d9488"
                        />
                        <div
                          className="kpi-performance-pill"
                          style={getPerformanceLevel(
                            akashKpi.overall_score_monthly_percent ?? akashKpi.overall_score_percent,
                          )}
                        >
                          {
                            getPerformanceLevel(
                              akashKpi.overall_score_monthly_percent ?? akashKpi.overall_score_percent,
                            ).label
                          }{' '}
                          Performance
                        </div>
                      </Space>
                    </Card>
                  </Col>
                )}
                {usesSuccessKpiSection(selectedPerson) && data?.successKpi != null && (
                <Col xs={24} sm={24} md={8}>
                  <Card
                    size="small"
                    title="Success KPI (Monthly %)"
                    className="kpi-summary-card kpi-summary-card--support kpi-summary-card--clickable"
                    style={{ borderTop: '3px solid #FAAD14', cursor: 'pointer' }}
                    onClick={() => setGraphModal('successKpi')}
                  >
                    <Space direction="vertical" align="center">
                      <Progress type="circle" percent={data.successKpi.overallPercentage ?? 0} size={80} strokeColor="#FAAD14" />
                      <div
                        className="kpi-performance-pill"
                        style={getPerformanceLevel(data.successKpi.overallPercentage)}
                      >
                        {getPerformanceLevel(data.successKpi.overallPercentage).label} Performance
                      </div>
                      <Text type="secondary" style={{ fontSize: 12 }}>Click to see weekly %</Text>
                    </Space>
                  </Card>
                </Col>
                )}
              </Row>
            )}

            <>
              {checklist && (
                <Card
                  className="kpi-section-card"
                  title={
                    <Space>
                      <CheckSquareOutlined />
                      Checklist (Weekly: {checklist.weeklyPercentage ?? 0}%)
                    </Space>
                  }
                >
                  {(checklistRows.length ?? 0) > 0 ? (
                    <Table
                      size="small"
                      dataSource={checklistRows.map((r, i) => ({ ...r, key: i }))}
                      columns={[
                        { title: 'Task', dataIndex: 'task_name', key: 'task_name' },
                        { title: 'Frequency', dataIndex: 'frequency', key: 'frequency', width: 100 },
                        {
                          title: 'Status',
                          dataIndex: 'status',
                          key: 'status',
                          width: 220,
                          render: (_s: string, row: { status?: string; pending_count?: number; completed_count?: number }) => {
                            const pending = row.pending_count ?? 0
                            const completed = row.completed_count ?? 0
                            const label = row.status || `${pending} Pending / ${completed} Completed`
                            return (
                              <Space size={4} wrap>
                                {pending > 0 ? (
                                  <Tag
                                    style={{
                                      background: 'rgba(255,193,7,0.1)',
                                      color: '#FFC107',
                                      borderColor: 'rgba(255,193,7,0.2)',
                                    }}
                                  >
                                    {pending} Pending
                                  </Tag>
                                ) : null}
                                {completed > 0 ? (
                                  <Tag
                                    style={{
                                      background: 'rgba(40,167,69,0.1)',
                                      color: '#28A745',
                                      borderColor: 'rgba(40,167,69,0.2)',
                                    }}
                                  >
                                    {completed} Completed
                                  </Tag>
                                ) : null}
                                {pending === 0 && completed === 0 ? (
                                  <Text type="secondary">{label}</Text>
                                ) : null}
                              </Space>
                            )
                          },
                        },
                      ]}
                      pagination={false}
                    />
                  ) : (
                    <Text type="secondary">No checklist occurrences for this week. Try another week or month.</Text>
                  )}
                </Card>
              )}

              {delegation && (
                <Card
                  className="kpi-section-card"
                  title={
                    <Space>
                      <SwapOutlined />
                      Delegation (Weekly: {delegation.weeklyPercentage ?? 0}%)
                    </Space>
                  }
                >
                  {(delegation.rows?.filter((r) => !isCancelledDelegationKpiRow(r.status)).length ?? 0) > 0 ? (
                    <Table
                      size="small"
                      dataSource={
                        delegation.rows
                          ?.filter((r) => !isCancelledDelegationKpiRow(r.status))
                          .map((r, i) => ({ ...r, key: i })) ?? []
                      }
                      columns={[
                        { title: 'Task', dataIndex: 'task', key: 'task' },
                        {
                          title: 'Status',
                          dataIndex: 'status',
                          key: 'status',
                          width: 140,
                          render: (s: string) => {
                            const v = (s || '').toLowerCase()
                            if (v === 'completed') {
                              return (
                                <Tag
                                  style={{
                                    background: 'rgba(40,167,69,0.1)',
                                    color: '#28A745',
                                    borderColor: 'rgba(40,167,69,0.2)',
                                  }}
                                >
                                  Completed
                                </Tag>
                              )
                            }
                            if (v === 'in progress') {
                              return (
                                <Tag
                                  style={{
                                    background: 'rgba(23,162,184,0.1)',
                                    color: '#17A2B8',
                                    borderColor: 'rgba(23,162,184,0.2)',
                                  }}
                                >
                                  In Progress
                                </Tag>
                              )
                            }
                            return (
                              <Tag
                                style={{
                                  background: 'rgba(255,193,7,0.1)',
                                  color: '#FFC107',
                                  borderColor: 'rgba(255,193,7,0.2)',
                                }}
                              >
                                Pending
                              </Tag>
                            )
                          },
                        },
                        { title: 'Shifted Week', dataIndex: 'shifted_week', key: 'shifted_week', width: 100 },
                        { title: 'Month', dataIndex: 'month', key: 'month', width: 80 },
                      ]}
                      pagination={false}
                    />
                  ) : (
                    <Text type="secondary">No delegation tasks for this week. Try another week or month.</Text>
                  )}
                </Card>
              )}

              {selectedPerson === 'Souvik' && (
                <Card
                  className="kpi-section-card"
                  title={
                    <Space>
                      <PieChartOutlined />
                      EA Performance KPI
                    </Space>
                  }
                >
                  <SouvikDashboardView />
                </Card>
              )}

              {selectedPerson === 'Soumya' && (
                <Card
                  className="kpi-section-card kpi-section-card--support-fms"
                  title={
                    <Space>
                      <ThunderboltOutlined />
                      Soumya SLA Dashboard
                    </Space>
                  }
                >
                  <SoumyaDashboardView embedded month={month} year={year} week={week} />
                </Card>
              )}

              {isAkashLayout && akashKpi && (
                <Card
                  className="kpi-section-card"
                  title={
                    <Space wrap>
                      <PieChartOutlined />
                      KPI
                      <Tag color="cyan" style={{ marginLeft: 4 }}>
                        {akashKpi.overall_score_percent ?? 0}% weekly overall ({week})
                      </Tag>
                    </Space>
                  }
                >
                  <Row gutter={[10, 10]} wrap={false} className="kpi-akash-pillars-row">
                    {akashKpi.pillars.map((pillar) => {
                      const cs = akashKpi.customerSupport
                      const isCs = pillar.key === 'customer_support'
                      const pillarPct = pillar.score_percent ?? 0
                      const metricLine = (label: string, value: string | number) => (
                        <div key={label} className="kpi-akash-pillar-metric">
                          <span className="kpi-akash-pillar-metric__label">{label}: </span>
                          <span className="kpi-akash-pillar-metric__value">{value}</span>
                        </div>
                      )
                      return (
                        <Col flex="1 1 0" className="kpi-akash-pillar-col" key={pillar.key}>
                          <Card
                            size="small"
                            className={`kpi-success-card kpi-akash-pillar-card ${AKASH_KPI_PILLAR_CARD_CLASS[pillar.key] ?? 'kpi-success-card--poc'}${isCs ? ' kpi-akash-cs-card' : ''}`}
                            bordered={false}
                            title={pillar.title}
                            hoverable
                            style={{ cursor: isCs ? 'pointer' : 'default' }}
                            onClick={isCs ? () => setAkashCsModal(cs ?? null) : undefined}
                            extra={
                              <Space size={4} align="center">
                                {isCs ? (
                                  <UnorderedListOutlined
                                    className="kpi-akash-pillar-list-icon"
                                    title="View response / completion / pending lists"
                                  />
                                ) : null}
                                <Tag color="blue" className="kpi-akash-pillar-score-tag">
                                  {pillarPct}%
                                </Tag>
                              </Space>
                            }
                          >
                            <div className="kpi-akash-pillar-body">
                              {pillar.metrics.map((m) => metricLine(m.label, m.value))}
                              {isCs ? (
                                <p className="kpi-akash-pillar-hint">Click card for ticket lists</p>
                              ) : null}
                            </div>
                          </Card>
                        </Col>
                      )
                    })}
                  </Row>
                </Card>
              )}
            </>

            {/* Support FMS – Shreyasi & Soumya; clickable cards open detail modal */}
            {supportFMS && showsStandardSupportFms(selectedPerson) && (
              <Card
                className="kpi-section-card kpi-section-card--support-fms"
                title={
                  <Space>
                    <CustomerServiceOutlined />
                    <span className="support-fms-heading">
                      Support FMS (Weekly: {supportFMS.weeklyPercentage ?? 0}% · Monthly:{' '}
                      {supportFMS.monthlyPercentage ?? monthly?.supportFMS ?? 0}%)
                    </span>
                  </Space>
                }
              >
                <Row gutter={[16, 16]}>
                  <Col xs={24} md={8}>
                    <Card
                      size="small"
                      title="Response Delay"
                      hoverable
                      onClick={() => void openSupportFmsDetail('response_delay', 'Response Delay – Details')}
                      className="kpi-support-card kpi-support-card--response"
                      style={{ cursor: 'pointer', borderTop: '3px solid #FFC107' }}
                      extra={
                        (supportFMS.responseDelay?.value ?? 0) > 0 ? (
                          <UnorderedListOutlined title="Click to view list" />
                        ) : null
                      }
                    >
                      {supportFMS.responseDelay?.status === 'Good' ? (
                        <Text strong style={{ color: '#52c41a', fontSize: 16 }}>
                          Good
                        </Text>
                      ) : null}
                      <div style={{ marginTop: supportFMS.responseDelay?.status === 'Good' ? 4 : 0 }}>
                        <Text strong style={{ color: supportFMS.responseDelay?.status === 'Good' ? undefined : '#FFC107' }}>
                          {supportFMS.responseDelay?.value ?? 0}
                        </Text>{' '}
                        / {supportFMS.responseDelay?.target ?? 0}
                        {supportFMS.responseDelay?.percentage != null && (
                          <Text type="secondary"> ({supportFMS.responseDelay.percentage})</Text>
                        )}
                        {supportFMS.responseDelay?.healthPercent != null && (
                          <Text type="secondary"> · {supportFMS.responseDelay.healthPercent}%</Text>
                        )}
                      </div>
                      {(supportFMS.responseDelay?.value ?? 0) > 0 && (
                        <div style={{ marginTop: 8, fontSize: 12, color: '#FFC107' }}>
                          Click to view list ({supportFMS.responseDelay?.value ?? 0})
                        </div>
                      )}
                    </Card>
                  </Col>
                  <Col xs={24} md={8}>
                    <Card
                      size="small"
                      title="Completion Delay"
                      hoverable
                      onClick={() => void openSupportFmsDetail('completion_delay', 'Completion Delay – Details')}
                      className="kpi-support-card kpi-support-card--completion"
                      style={{ cursor: 'pointer', borderTop: '3px solid #FFC107' }}
                      extra={
                        (supportFMS.completionDelay?.value ?? 0) > 0 ? (
                          <UnorderedListOutlined title="Click to view list" />
                        ) : null
                      }
                    >
                      {supportFMS.completionDelay?.status === 'Good' ? (
                        <Text strong style={{ color: '#52c41a', fontSize: 16 }}>
                          Good
                        </Text>
                      ) : null}
                      <div style={{ marginTop: supportFMS.completionDelay?.status === 'Good' ? 4 : 0 }}>
                        <Text strong style={{ color: supportFMS.completionDelay?.status === 'Good' ? undefined : '#FFC107' }}>
                          {supportFMS.completionDelay?.value ?? 0}
                        </Text>{' '}
                        / {supportFMS.completionDelay?.target ?? 0}
                        {supportFMS.completionDelay?.percentage != null && (
                          <Text type="secondary"> ({supportFMS.completionDelay.percentage})</Text>
                        )}
                        {supportFMS.completionDelay?.healthPercent != null && (
                          <Text type="secondary"> · {supportFMS.completionDelay.healthPercent}%</Text>
                        )}
                      </div>
                      {(supportFMS.completionDelay?.value ?? 0) > 0 && (
                        <div style={{ marginTop: 8, fontSize: 12, color: '#FFC107' }}>
                          Click to view list ({supportFMS.completionDelay?.value ?? 0})
                        </div>
                      )}
                    </Card>
                  </Col>
                  <Col xs={24} md={8}>
                    <Card
                      size="small"
                      title="Pending Chores & Bugs"
                      hoverable
                      onClick={() =>
                        void openSupportFmsDetail('pending', 'Pending Chores & Bugs – Details')
                      }
                      className="kpi-support-card kpi-support-card--pending"
                      style={{ cursor: 'pointer', borderTop: '3px solid #FFC107' }}
                      extra={
                        (supportFMS.pendingChores?.value ?? 0) > 0 ? (
                          <UnorderedListOutlined title="Click to view list" />
                        ) : null
                      }
                    >
                      {supportFMS.pendingChores?.status === 'Good' ? (
                        <Text strong style={{ color: '#52c41a', fontSize: 16 }}>
                          Good
                        </Text>
                      ) : null}
                      <div style={{ marginTop: supportFMS.pendingChores?.status === 'Good' ? 4 : 0 }}>
                        <Text strong style={{ color: supportFMS.pendingChores?.status === 'Good' ? undefined : '#FFC107' }}>
                          {supportFMS.pendingChores?.value ?? 0}
                        </Text>{' '}
                        / {supportFMS.pendingChores?.target ?? 0}
                        {supportFMS.pendingChores?.percentage != null && (
                          <Text type="secondary"> ({supportFMS.pendingChores.percentage})</Text>
                        )}
                        {supportFMS.pendingChores?.healthPercent != null && (
                          <Text type="secondary"> · {supportFMS.pendingChores.healthPercent}%</Text>
                        )}
                      </div>
                      {(supportFMS.pendingChores?.value ?? 0) > 0 && (
                        <div style={{ marginTop: 8, fontSize: 12, color: '#FFC107' }}>
                          Click to view list ({supportFMS.pendingChores?.value ?? 0})
                        </div>
                      )}
                    </Card>
                  </Col>
                </Row>
              </Card>
            )}

            {/* KPI – Adrija: weekly social (Post / Reel / LinkedIn) */}
            {selectedPerson === 'Adrija' && adrijaSocial != null && (
              <Card
                className="kpi-section-card"
                title={
                  <Space wrap>
                    <PieChartOutlined />
                    KPI
                    {adrijaSocial.weekLabel ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {adrijaSocial.weekLabel}
                      </Text>
                    ) : null}
                    <Tag color="blue" style={{ marginLeft: 0 }}>
                      Week {adrijaSocial.weeklyPercent ?? 0}% (3 tasks / 7 days)
                    </Tag>
                  </Space>
                }
              >
                <Row gutter={[16, 16]}>
                  <Col xs={24} md={8}>
                    <Card
                      size="small"
                      className="kpi-success-card kpi-success-card--poc"
                      bordered={false}
                      title="1 Post Every Week"
                      hoverable
                      style={{ cursor: 'pointer' }}
                      onClick={() => setAdrijaPillarDetail('post')}
                    >
                      <Title level={4} style={{ marginBottom: 4 }}>
                        {adrijaSocial.postWeek ?? 0} / 1
                      </Title>
                      <Text type="secondary">Done tasks / target (week) · click to show details</Text>
                    </Card>
                  </Col>
                  <Col xs={24} md={8}>
                    <Card
                      size="small"
                      className="kpi-success-card kpi-success-card--training"
                      bordered={false}
                      title="1 Reel Every Week"
                      hoverable
                      style={{ cursor: 'pointer' }}
                      onClick={() => setAdrijaPillarDetail('reel')}
                    >
                      <Title level={4} style={{ marginBottom: 4 }}>
                        {adrijaSocial.reelWeek ?? 0} / 1
                      </Title>
                      <Text type="secondary">Done tasks / target (week) · click to show details</Text>
                    </Card>
                  </Col>
                  <Col xs={24} md={8}>
                    <Card
                      size="small"
                      className="kpi-success-card kpi-success-card--followup"
                      bordered={false}
                      title="1 LinkedIn Post Every Week"
                      hoverable
                      style={{ cursor: 'pointer' }}
                      onClick={() => setAdrijaPillarDetail('linkedin')}
                    >
                      <Title level={4} style={{ marginBottom: 4 }}>
                        {adrijaSocial.linkedinWeek ?? 0} / 1
                      </Title>
                      <Text type="secondary">Done tasks / target (week) · click to show details</Text>
                    </Card>
                  </Col>
                </Row>
              </Card>
            )}

            {/* Success KPI – Rimpa (Performance Monitoring): monthly % + detail cards */}
            {usesSuccessKpiSection(selectedPerson) && successKpi != null && (
              <Card
                className="kpi-section-card"
                title={
                  <Space>
                    <CustomerServiceOutlined />
                    Success KPI
                    <Tag color="gold" style={{ marginLeft: 8 }}>
                      {successKpi.overallPercentage ?? 0}% Overall (selected week)
                    </Tag>
                    {successKpi.meta?.weekLabel && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {successKpi.meta.weekLabel}
                      </Text>
                    )}
                  </Space>
                }
              >
                <Row gutter={[16, 16]}>
                  {successKpi.meta?.pocIncluded !== false && (
                    <Col xs={24} md={6}>
                      <Card
                        size="small"
                        className="kpi-success-card kpi-success-card--poc"
                        bordered={false}
                        title="POC Collected"
                        hoverable
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSuccessModal({ type: 'poc', title: 'POC Collected – Details' })}
                      >
                        <Title level={4} style={{ marginBottom: 4 }}>
                          {successKpi.pocCollected.currentValue}/{successKpi.pocCollected.targetValue || 0}
                        </Title>
                        <Text type="secondary">POC entries added this week</Text>
                      </Card>
                    </Col>
                  )}
                  <Col xs={24} md={successKpi.meta?.pocIncluded === false ? 8 : 6}>
                    <Card
                      size="small"
                      className="kpi-success-card kpi-success-card--training"
                      bordered={false}
                      title="Weekly Training Target"
                      hoverable
                      onClick={() => setSuccessModal({ type: 'training', title: 'Weekly Training Target – Details' })}
                    >
                      <Title level={4} style={{ marginBottom: 4 }}>
                        {successKpi.weeklyTrainingTarget.currentValue}/{successKpi.weeklyTrainingTarget.targetValue || 0}
                      </Title>
                      <Text type="secondary">Trainings completed this week</Text>
                    </Card>
                  </Col>
                  <Col xs={24} md={successKpi.meta?.pocIncluded === false ? 8 : 6}>
                    <Card
                      size="small"
                      className="kpi-success-card kpi-success-card--followup"
                      bordered={false}
                      title="Training Follow-up"
                      hoverable
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSuccessModal({ type: 'followup', title: 'Training Follow-up – Details' })}
                    >
                      <Title level={4} style={{ marginBottom: 4 }}>
                        {successKpi.trainingFollowUp.currentValue}/{successKpi.trainingFollowUp.targetValue || 0}
                      </Title>
                      <Text type="secondary">Follow-up calls logged</Text>
                    </Card>
                  </Col>
                  <Col xs={24} md={successKpi.meta?.pocIncluded === false ? 8 : 6}>
                    <Card
                      size="small"
                      className="kpi-success-card kpi-success-card--increase"
                      bordered={false}
                      title="Success Increase"
                      hoverable
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSuccessModal({ type: 'increase', title: 'Success Increase – Details' })}
                    >
                      <Title level={4} style={{ marginBottom: 4 }}>
                        {successKpi.successIncrease.currentValue}/{successKpi.successIncrease.targetValue || 0}
                      </Title>
                      <Text type="secondary">Companies with usage increase</Text>
                    </Card>
                  </Col>
                </Row>
              </Card>
            )}

            {/* Detail modal for Success KPI cards */}
            {successKpi && successModal && usesSuccessKpiSection(selectedPerson) && (
              <Modal
                title={successModal.title}
                open={!!successModal}
                onCancel={() => setSuccessModal(null)}
                footer={null}
                width={900}
                className="kpi-modal"
              >
                {successModal.type === 'poc' && (
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <Alert
                      type="info"
                      showIcon
                      message="POC Collected (selected week)"
                      description={
                        <>
                          Count on the card ={' '}
                          <strong>
                            {successKpi.pocCollected.currentValue}/{successKpi.pocCollected.targetValue ?? 16}
                          </strong>
                          : every Performance Monitoring POC with <strong>created date</strong> in this week. Rows
                          below match that count.
                        </>
                      }
                    />
                    <Table
                      size="small"
                      dataSource={(successKpi.pocCollected.details?.companies ?? []).map((company, i) => ({
                        key: i,
                        reference: successKpi.pocCollected.details.referenceNumbers?.[i] ?? '',
                        company,
                        messageOwner: successKpi.pocCollected.details.messageOwner?.[i] ?? '',
                        date: successKpi.pocCollected.details.dates?.[i] ?? '',
                        response: successKpi.pocCollected.details.responses?.[i] ?? '',
                        contact: successKpi.pocCollected.details.contacts?.[i] ?? '',
                      }))}
                      columns={[
                        { title: 'Reference', dataIndex: 'reference', key: 'reference', width: 120 },
                        { title: 'Company', dataIndex: 'company', key: 'company', width: 160, ellipsis: false, render: (v: string) => <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', display: 'block' }}>{v ?? '—'}</span> },
                        { title: 'Message Owner', dataIndex: 'messageOwner', key: 'messageOwner', width: 110 },
                        {
                          title: 'Entered at',
                          dataIndex: 'date',
                          key: 'date',
                          width: 160,
                          render: (v: string) => formatQueryArrival(v),
                        },
                        { title: 'Response', dataIndex: 'response', key: 'response' },
                        { title: 'Contact', dataIndex: 'contact', key: 'contact', width: 140 },
                      ]}
                      pagination={{ pageSize: 10 }}
                    />
                  </Space>
                )}
                {successModal.type === 'training' && (
                  <Table
                    size="small"
                    dataSource={(successKpi.weeklyTrainingTarget.details?.companies ?? []).map((company, i) => ({
                      key: i,
                      company,
                      callPOC: successKpi.weeklyTrainingTarget.details.callPOC?.[i] ?? '',
                      messagePOC: successKpi.weeklyTrainingTarget.details.messagePOC?.[i] ?? '',
                      trainingDate: successKpi.weeklyTrainingTarget.details.trainingDates?.[i] ?? '',
                      status: successKpi.weeklyTrainingTarget.details.trainingStatus?.[i] ?? '',
                      remarks: successKpi.weeklyTrainingTarget.details.remarks?.[i] ?? '',
                    }))}
                    columns={[
                      { title: 'Company', dataIndex: 'company', key: 'company', width: 160, ellipsis: false, render: (v: string) => <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', display: 'block' }}>{v ?? '—'}</span> },
                      { title: 'Call POC', dataIndex: 'callPOC', key: 'callPOC', width: 90 },
                      { title: 'Message POC', dataIndex: 'messagePOC', key: 'messagePOC', width: 110 },
                      { title: 'Training Date', dataIndex: 'trainingDate', key: 'trainingDate', width: 130 },
                      { title: 'Status', dataIndex: 'status', key: 'status', width: 100 },
                      { title: 'Remarks', dataIndex: 'remarks', key: 'remarks' },
                    ]}
                    pagination={{ pageSize: 10 }}
                  />
                )}
                {successModal.type === 'followup' && (
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <Alert
                      type="info"
                      showIcon
                      message="Training Follow-up (selected week)"
                      description={
                        <>
                          Total toward KPI:{' '}
                          <strong>
                            {successKpi.trainingFollowUp.currentValue}/{successKpi.trainingFollowUp.targetValue ?? 25}
                          </strong>{' '}
                          = follow-up rows logged (
                          {successKpi.trainingFollowUp.details?.followupRowsWeek ?? '—'}) + &quot;Add follow-up&quot; button
                          clicks ({successKpi.trainingFollowUp.details?.clickCountWeek ?? '—'}).
                        </>
                      }
                    />
                    <Title level={5} style={{ margin: 0 }}>
                      Follow-up rows
                    </Title>
                    <Table
                      size="small"
                      dataSource={(successKpi.trainingFollowUp.details?.companies ?? []).map((company, i) => ({
                        key: `fu-${i}`,
                        company,
                        before: successKpi.trainingFollowUp.details.beforePercentages?.[i] ?? null,
                        after: successKpi.trainingFollowUp.details.afterPercentages?.[i] ?? null,
                        feature: successKpi.trainingFollowUp.details.features?.[i]?.[0] ?? '',
                      }))}
                      columns={[
                        { title: 'Company', dataIndex: 'company', key: 'company', width: 160, ellipsis: false, render: (v: string) => <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', display: 'block' }}>{v ?? '—'}</span> },
                        { title: 'Feature', dataIndex: 'feature', key: 'feature', width: 120, ellipsis: true },
                        { title: 'Before %', dataIndex: 'before', key: 'before', width: 100 },
                        { title: 'After %', dataIndex: 'after', key: 'after', width: 100 },
                      ]}
                      pagination={{ pageSize: 10 }}
                    />
                    {(successKpi.trainingFollowUp.details?.clickEventsWeek?.length ?? 0) > 0 && (
                      <>
                        <Title level={5} style={{ margin: 0 }}>
                          Follow-up button clicks (timestamps)
                        </Title>
                        <Table
                          size="small"
                          dataSource={(successKpi.trainingFollowUp.details.clickEventsWeek ?? []).map((row, i) => ({
                            key: `clk-${i}`,
                            company: row.company ?? '',
                            feature: row.feature ?? '',
                            clickedAt: row.clickedAt ?? '',
                          }))}
                          columns={[
                            { title: 'Company', dataIndex: 'company', key: 'company', width: 160, ellipsis: false, render: (v: string) => <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', display: 'block' }}>{v ?? '—'}</span> },
                            { title: 'Feature', dataIndex: 'feature', key: 'feature', width: 140 },
                            {
                              title: 'Clicked at',
                              dataIndex: 'clickedAt',
                              key: 'clickedAt',
                              width: 180,
                              render: (v: string) => formatQueryArrival(v),
                            },
                          ]}
                          pagination={{ pageSize: 10 }}
                        />
                      </>
                    )}
                  </Space>
                )}
                {successModal.type === 'increase' && (
                  <Table
                    size="small"
                    dataSource={(successKpi.successIncrease.details?.companies ?? []).map((company, i) => ({
                      key: i,
                      company,
                      feature: successKpi.successIncrease.details.features?.[i]?.[0] ?? '',
                      before: successKpi.successIncrease.details.beforePercentages?.[i] ?? null,
                      after: successKpi.successIncrease.details.afterPercentages?.[i] ?? null,
                    }))}
                    columns={[
                      { title: 'Company', dataIndex: 'company', key: 'company', width: 160, ellipsis: false, render: (v: string) => <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', display: 'block' }}>{v ?? '—'}</span> },
                      { title: 'Feature', dataIndex: 'feature', key: 'feature', width: 140, ellipsis: true, render: (v: string) => v || '—' },
                      { title: 'Before %', dataIndex: 'before', key: 'before', width: 100 },
                      { title: 'After %', dataIndex: 'after', key: 'after', width: 100 },
                    ]}
                    pagination={{ pageSize: 10 }}
                  />
                )}
              </Modal>
            )}

            {/* Weekly % graph modal – opened when user clicks a monthly summary card */}
            <Modal
              title={
                graphModal === 'akashMonthly'
                  ? `KPI Monthly – pillar scores (${month} ${year})`
                  : graphModal
                    ? `Weekly % – ${graphModal === 'checklist' ? 'Checklist' : graphModal === 'delegation' ? 'Delegation' : graphModal === 'supportFMS' ? 'Support FMS' : 'Success KPI'} (${month} ${year})`
                    : ''
              }
              open={!!graphModal}
              onCancel={() => setGraphModal(null)}
              footer={null}
              width={graphModal === 'akashMonthly' ? 'min(96vw, 720px)' : 'min(96vw, 640)'}
              className="kpi-modal kpi-graph-modal"
            >
              {graphModal === 'akashMonthly' && akashKpi?.monthly?.pillars && akashKpi.monthly.pillars.length > 0 ? (
                <Suspense
                  fallback={<ChartAreaSkeleton height={320} />}
                >
                  <LazyAkashMonthlyBarChart pillars={akashKpi.monthly.pillars} month={month} year={year} />
                </Suspense>
              ) : null}
              {graphModal === 'akashMonthly' && (!akashKpi?.monthly?.pillars || akashKpi.monthly.pillars.length === 0) ? (
                <Text type="secondary">No monthly pillar data available.</Text>
              ) : null}
              {graphModal && graphModal !== 'akashMonthly' && data?.weeklyProgress && (
                <Suspense
                  fallback={<ChartAreaSkeleton height={320} />}
                >
                  <LazyWeeklyBarChart graphModal={graphModal} weeklyProgress={data.weeklyProgress} />
                </Suspense>
              )}
              {graphModal &&
                graphModal !== 'akashMonthly' &&
                (!data?.weeklyProgress || (data.weeklyProgress.weeks?.length ?? 0) === 0) && (
                <Text type="secondary">No weekly data available for this month.</Text>
              )}
            </Modal>

            {/* Detail modal for Support FMS cards */}
            <Modal
              title={detailModal?.title}
              open={!!detailModal}
              onCancel={() => setDetailModal(null)}
              footer={null}
              width="min(96vw, 900px)"
              className="kpi-modal"
              destroyOnClose
            >
              {detailModal && (
                <Spin spinning={detailModal.loading}>
                <Table
                  size="small"
                  dataSource={detailModal.items.map((item, i) => ({ ...item, key: i }))}
                  scroll={{ x: 'max-content' }}
                  columns={[
                    { title: 'Ref', dataIndex: 'reference_no', key: 'reference_no', width: 100 },
                    { title: 'Type', dataIndex: 'type', key: 'type', width: 80 },
                    {
                      title: 'Company',
                      dataIndex: 'company',
                      key: 'company',
                      width: 160,
                      ellipsis: false,
                      render: (val: string) => (
                        <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', display: 'block' }}>
                          {val ?? '—'}
                        </span>
                      ),
                    },
                    {
                      title: 'Title & Description',
                      key: 'title_description',
                      width: 280,
                      ellipsis: true,
                      render: (_: unknown, record: SupportFmsDelayItem) => (
                        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          <span style={{ fontWeight: 600 }}>{record.title ?? '—'}</span>
                          {record.description ? (
                            <>
                              <br />
                              <span style={{ fontWeight: 400 }}>{record.description}</span>
                            </>
                          ) : null}
                        </div>
                      ),
                    },
                    { title: 'Query Arrival', dataIndex: 'query_arrival', key: 'query_arrival', width: 160, render: (v: string) => formatQueryArrival(v) },
                    ...(detailModal.title.startsWith('Pending Chores')
                      ? [
                          {
                            title: 'Delay (Stage 2)',
                            dataIndex: 'delay_time',
                            key: 'stage2_delay',
                            width: 140,
                            render: (v: string) => v ?? '—',
                          },
                        ]
                      : []),
                    ...(detailModal.title.startsWith('Response Delay') || detailModal.title.startsWith('Completion Delay')
                      ? [{ title: 'Delay / Note', dataIndex: 'delay_time', key: 'delay_time', width: 120, render: (v: string) => v ?? '—' }]
                      : []),
                  ]}
                  pagination={detailModal.items.length > 10 ? { pageSize: 10 } : false}
                />
                {!detailModal.loading && detailModal.items.length === 0 ? (
                  <Text type="secondary">No items in this list.</Text>
                ) : null}
                </Spin>
              )}
            </Modal>

            <Modal
              title="KPI daily work log"
              open={kpiDailyLogOpen}
              onCancel={() => setKpiDailyLogOpen(false)}
              width="min(98vw, 1280px)"
              className="kpi-modal"
              okText="Save changes"
              cancelText="Close"
              okButtonProps={{ disabled: !kpiDailyLogTableVisible }}
              onOk={() => saveKpiDailyLogChanges()}
              destroyOnClose
            >
              <Row gutter={[16, 12]} align="middle" style={{ marginBottom: 12 }}>
                <Col xs={24} sm={12}>
                  <Text strong>Log month</Text>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Change the month to show the table (including completed months).
                    </Text>
                  </div>
                </Col>
                <Col xs={24} sm={12} style={{ textAlign: 'right' }}>
                  <DatePicker
                    picker="month"
                    value={kpiDailyLogMonth}
                    format="MMM YYYY"
                    allowClear={false}
                    onChange={(d) => {
                      if (!d) return
                      const next = d.startOf('month')
                      setKpiDailyLogMonth(next)
                      setKpiDailyLogTableVisible(true)
                    }}
                  />
                </Col>
              </Row>
              {!kpiDailyLogTableVisible && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="Table hidden for this completed month"
                  description="Pick another month above, or re-select the same month, to load the daily log."
                />
              )}
              <SkeletonOverlay loading={kpiDailyLogLoading} rows={12} minHeight={320}>
                <Table<KpiDailyLogTableRow>
                  size="small"
                  rowKey="work_date"
                  dataSource={kpiDailyLogTableVisible ? kpiDailyLogRows : []}
                  scroll={{ x: 1300 }}
                  pagination={
                    kpiDailyLogTableVisible && kpiDailyLogRows.length > 0
                      ? { pageSize: 31, showSizeChanger: false, hideOnSinglePage: true }
                      : false
                  }
                  columns={[
                    {
                      title: 'Date',
                      dataIndex: 'work_date',
                      key: 'work_date',
                      width: 108,
                      fixed: 'left',
                      render: (iso: string) => dayjs(iso).format('D-MMM-YY'),
                    },
                    { title: 'Day', dataIndex: 'dayName', key: 'dayName', width: 92 },
                    {
                      title: 'Items cleaned',
                      key: 'items_cleaned',
                      width: 118,
                      render: (_: unknown, row) => (
                        <InputNumber
                          min={0}
                          controls={false}
                          style={{ width: '100%' }}
                          value={row.items_cleaned ?? undefined}
                          onChange={(v) => patchKpiDailyLogRow(row.work_date, { items_cleaned: v ?? null })}
                        />
                      ),
                    },
                    {
                      title: 'Errors found',
                      key: 'errors_found',
                      width: 110,
                      render: (_: unknown, row) => (
                        <InputNumber
                          min={0}
                          step={0.1}
                          controls={false}
                          style={{ width: '100%' }}
                          value={row.errors_found ?? undefined}
                          onChange={(v) => patchKpiDailyLogRow(row.work_date, { errors_found: v ?? null })}
                        />
                      ),
                    },
                    {
                      title: 'Videos created',
                      key: 'videos_created',
                      width: 118,
                      render: (_: unknown, row) => (
                        <InputNumber
                          min={0}
                          controls={false}
                          style={{ width: '100%' }}
                          value={row.videos_created ?? undefined}
                          onChange={(v) => patchKpiDailyLogRow(row.work_date, { videos_created: v ?? null })}
                        />
                      ),
                    },
                    {
                      title: 'Video type',
                      dataIndex: 'video_type',
                      key: 'video_type',
                      width: 120,
                      render: (_: string | null | undefined, row) => (
                        <Input
                          size="small"
                          placeholder="e.g. Short"
                          value={row.video_type ?? ''}
                          onChange={(e) => patchKpiDailyLogRow(row.work_date, { video_type: e.target.value || null })}
                        />
                      ),
                    },
                    {
                      title: 'Bulk upload',
                      key: 'bulk_upload_tickets',
                      width: 118,
                      render: (_: unknown, row) => (
                        <InputNumber
                          min={0}
                          controls={false}
                          style={{ width: '100%' }}
                          value={row.bulk_upload_tickets ?? undefined}
                          onChange={(v) => patchKpiDailyLogRow(row.work_date, { bulk_upload_tickets: v ?? null })}
                        />
                      ),
                    },
                    {
                      title: 'AI tasks used',
                      key: 'ai_tasks_used',
                      width: 112,
                      render: (_: unknown, row) => (
                        <InputNumber
                          min={0}
                          controls={false}
                          style={{ width: '100%' }}
                          value={row.ai_tasks_used ?? undefined}
                          onChange={(v) => patchKpiDailyLogRow(row.work_date, { ai_tasks_used: v ?? null })}
                        />
                      ),
                    },
                    {
                      title: 'Process improved',
                      key: 'process_improved',
                      width: 120,
                      render: (_: unknown, row) => (
                        <InputNumber
                          min={0}
                          controls={false}
                          style={{ width: '100%' }}
                          value={row.process_improved ?? undefined}
                          onChange={(v) => patchKpiDailyLogRow(row.work_date, { process_improved: v ?? null })}
                        />
                      ),
                    },
                  ]}
                />
              </SkeletonOverlay>
            </Modal>

            <Modal
              title="Adrija KPI — daily log"
              open={adrijaSocialModalOpen}
              onCancel={() => setAdrijaSocialModalOpen(false)}
              okText="Save changes"
              cancelText="Close"
              confirmLoading={adrijaSocialSaving}
              onOk={() => void saveAdrijaSocialDaily()}
              width="min(98vw, 900px)"
              className="kpi-modal"
              destroyOnClose
            >
              <Row gutter={[16, 12]} align="middle" style={{ marginBottom: 12 }}>
                <Col xs={24} sm={12}>
                  <Text strong>Log month</Text>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Every row is one calendar day. Check Post, Reel, or LinkedIn when completed that day.
                    </Text>
                  </div>
                </Col>
                <Col xs={24} sm={12} style={{ textAlign: 'right' }}>
                  <DatePicker
                    picker="month"
                    value={adrijaSocialLogMonth ?? undefined}
                    format="MMM YYYY"
                    allowClear={false}
                    onChange={(d) => {
                      if (!d) return
                      setAdrijaSocialLogMonth(d.startOf('month'))
                    }}
                  />
                </Col>
              </Row>
              <SkeletonOverlay loading={adrijaSocialDailyLoading} rows={12} minHeight={280}>
                <Table<AdrijaSocialKpiDailyRow>
                  size="small"
                  rowKey="work_date"
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  dataSource={adrijaSocialDailyRows}
                  columns={[
                    {
                      title: 'Date',
                      dataIndex: 'work_date',
                      key: 'work_date',
                      width: 108,
                      render: (iso: string) => dayjs(iso).format('DD-MMM-YY'),
                    },
                    { title: 'Day', dataIndex: 'dayName', key: 'dayName', width: 100 },
                    {
                      title: 'Post',
                      key: 'post',
                      width: 210,
                      render: (_: unknown, row) => (
                        <Space direction="vertical" size={6} style={{ width: '100%' }}>
                          <Checkbox
                            checked={row.post === 1}
                            disabled={!canEditAdrijaSocial}
                            onChange={(e) =>
                              patchAdrijaSocialDailyRow(row.work_date, {
                                post: e.target.checked ? 1 : 0,
                                post_task_name: e.target.checked ? row.post_task_name ?? '' : '',
                              })
                            }
                          />
                          {row.post === 1 && (
                            <Input
                              size="small"
                              placeholder="Task name (required)"
                              value={row.post_task_name ?? ''}
                              disabled={!canEditAdrijaSocial}
                              status={(row.post_task_name || '').trim() ? undefined : 'error'}
                              onChange={(e) => patchAdrijaSocialDailyRow(row.work_date, { post_task_name: e.target.value })}
                            />
                          )}
                        </Space>
                      ),
                    },
                    {
                      title: 'Reel',
                      key: 'reel',
                      width: 210,
                      render: (_: unknown, row) => (
                        <Space direction="vertical" size={6} style={{ width: '100%' }}>
                          <Checkbox
                            checked={row.reel === 1}
                            disabled={!canEditAdrijaSocial}
                            onChange={(e) =>
                              patchAdrijaSocialDailyRow(row.work_date, {
                                reel: e.target.checked ? 1 : 0,
                                reel_task_name: e.target.checked ? row.reel_task_name ?? '' : '',
                              })
                            }
                          />
                          {row.reel === 1 && (
                            <Input
                              size="small"
                              placeholder="Task name (required)"
                              value={row.reel_task_name ?? ''}
                              disabled={!canEditAdrijaSocial}
                              status={(row.reel_task_name || '').trim() ? undefined : 'error'}
                              onChange={(e) => patchAdrijaSocialDailyRow(row.work_date, { reel_task_name: e.target.value })}
                            />
                          )}
                        </Space>
                      ),
                    },
                    {
                      title: 'LinkedIn',
                      key: 'linkedin',
                      width: 210,
                      render: (_: unknown, row) => (
                        <Space direction="vertical" size={6} style={{ width: '100%' }}>
                          <Checkbox
                            checked={row.linkedin === 1}
                            disabled={!canEditAdrijaSocial}
                            onChange={(e) =>
                              patchAdrijaSocialDailyRow(row.work_date, {
                                linkedin: e.target.checked ? 1 : 0,
                                linkedin_task_name: e.target.checked ? row.linkedin_task_name ?? '' : '',
                              })
                            }
                          />
                          {row.linkedin === 1 && (
                            <Input
                              size="small"
                              placeholder="Task name (required)"
                              value={row.linkedin_task_name ?? ''}
                              disabled={!canEditAdrijaSocial}
                              status={(row.linkedin_task_name || '').trim() ? undefined : 'error'}
                              onChange={(e) => patchAdrijaSocialDailyRow(row.work_date, { linkedin_task_name: e.target.value })}
                            />
                          )}
                        </Space>
                      ),
                    },
                  ]}
                />
              </SkeletonOverlay>
            </Modal>

            <Modal
              title={
                adrijaPillarDetail
                  ? `${ADRIJA_KPI_TASK_LABEL[adrijaPillarDetail]} — selected week`
                  : 'KPI detail'
              }
              open={adrijaPillarDetail != null}
              onCancel={() => setAdrijaPillarDetail(null)}
              footer={null}
              width={520}
            >
              {adrijaPillarDetail && adrijaSocial && (() => {
                const details =
                  adrijaPillarDetail === 'post'
                    ? (adrijaSocial.postCompletionDetails ?? []).map((x) => ({ completion_date: x.date, task: x.taskName || '—' }))
                    : adrijaPillarDetail === 'reel'
                      ? (adrijaSocial.reelCompletionDetails ?? []).map((x) => ({ completion_date: x.date, task: x.taskName || '—' }))
                      : (adrijaSocial.linkedinCompletionDetails ?? []).map((x) => ({ completion_date: x.date, task: x.taskName || '—' }))
                const rows = details
                  .filter((x) => x.completion_date >= adrijaSocial.weekStart && x.completion_date <= adrijaSocial.weekEnd)
                  .sort((a, b) => (a.completion_date < b.completion_date ? -1 : 1))
                if (rows.length === 0) {
                  return (
                    <Text type="secondary">
                      No completion marked for this task in the selected week. Use Add to log a day, or pick another
                      week.
                    </Text>
                  )
                }
                return (
                  <Table
                    size="small"
                    rowKey="completion_date"
                    pagination={false}
                    dataSource={rows}
                    columns={[
                      { title: 'Task', dataIndex: 'task', key: 'task', width: 220 },
                      {
                        title: 'Marked complete (date)',
                        dataIndex: 'completion_date',
                        key: 'completion_date',
                        render: (iso: string) => dayjs(iso).format('dddd, DD MMM YYYY'),
                      },
                    ]}
                  />
                )
              })()}
            </Modal>

            <Modal
              title={`KPI monthly summary — ${month} ${year}`}
              open={adrijaMonthlySummaryOpen}
              onCancel={() => setAdrijaMonthlySummaryOpen(false)}
              footer={null}
              width={480}
            >
              {adrijaSocial && (
                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                  <Text>
                    Overall fill rate for {month} {year}:{' '}
                    <Text strong>{adrijaSocial.monthlyPercent ?? 0}%</Text>
                  </Text>
                  <Text type="secondary">
                    Percentage = (Post + Reel + LinkedIn checks across all days) ÷ (3 × number of days in the month).
                  </Text>
                  <div style={{ marginTop: 8 }}>
                    <Text>Days with Post marked: {(adrijaSocial.postCompletionDates ?? []).length}</Text>
                  </div>
                  <div>
                    <Text>Days with Reel marked: {(adrijaSocial.reelCompletionDates ?? []).length}</Text>
                  </div>
                  <div>
                    <Text>Days with LinkedIn marked: {(adrijaSocial.linkedinCompletionDates ?? []).length}</Text>
                  </div>
                </Space>
              )}
            </Modal>

            <Modal
              title={
                akashCsModal
                  ? `Customer Support – Prior arrivals: ${akashCsModal.meta?.dataRangeLabel ?? '—'} · Selected week: ${akashCsModal.meta?.selectedWeekRangeLabel ?? '—'}`
                  : ''
              }
              open={!!akashCsModal}
              onCancel={() => setAkashCsModal(null)}
              footer={null}
              width="min(96vw, 960px)"
              className="kpi-modal"
            >
              {akashCsModal?.meta?.helpNote && (
                <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Data window" description={akashCsModal.meta.helpNote} />
              )}
              {akashCsModal && (
                <Tabs
                  defaultActiveKey="response"
                  items={[
                    {
                      key: 'response',
                      label: `Response delays (${akashCsModal.responseDelayCount ?? 0})`,
                      children: (
                        <Table
                          size="small"
                          rowKey={(_, i) => `rd-${i}`}
                          dataSource={(akashCsModal.detailsResponseDelay ?? []).map((r, i) => ({ ...r, key: i }))}
                          columns={AKASH_CS_TABLE_COLUMNS.map((c) =>
                            c.key === 'delay_note' ? { ...c, title: 'Response SLA / note' } : c,
                          )}
                          pagination={(akashCsModal.detailsResponseDelay?.length ?? 0) > 10 ? { pageSize: 10 } : false}
                          scroll={{ x: 'max-content' }}
                        />
                      ),
                    },
                    {
                      key: 'completion',
                      label: `Completion delays (${akashCsModal.completionDelayCount ?? 0})`,
                      children: (
                        <Table
                          size="small"
                          rowKey={(_, i) => `cd-${i}`}
                          dataSource={(akashCsModal.detailsCompletionDelay ?? []).map((r, i) => ({ ...r, key: i }))}
                          columns={AKASH_CS_TABLE_COLUMNS.map((c) =>
                            c.key === 'delay_note' ? { ...c, title: 'Stage 2 completion note' } : c,
                          )}
                          pagination={(akashCsModal.detailsCompletionDelay?.length ?? 0) > 10 ? { pageSize: 10 } : false}
                          scroll={{ x: 'max-content' }}
                        />
                      ),
                    },
                    {
                      key: 'pending',
                      label: `Pending (${akashCsModal.pendingCount ?? 0})`,
                      children: (
                        <Table
                          size="small"
                          rowKey={(_, i) => `pd-${i}`}
                          dataSource={(akashCsModal.detailsPending ?? []).map((r, i) => ({ ...r, key: i }))}
                          columns={AKASH_CS_TABLE_COLUMNS.map((c) =>
                            c.key === 'delay_note' ? { ...c, title: 'Open vs Stage 2 SLA' } : c,
                          )}
                          pagination={(akashCsModal.detailsPending?.length ?? 0) > 10 ? { pageSize: 10 } : false}
                          scroll={{ x: 'max-content' }}
                        />
                      ),
                    },
                  ]}
                />
              )}
            </Modal>

            {!checklist && !delegation && !supportFMS && data.success && !akashKpi && (
              <Card>
                <Text type="secondary">No data for the selected filters. Try another month, year, or week.</Text>
              </Card>
            )}
          </>
        )}

        {!loading && data?.success === false && (
          <Card>
            <Text type="danger">{data.error || 'Failed to load dashboard data.'}</Text>
          </Card>
        )}
      </Space>
    </div>
  )
}
