import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Card,
  Typography,
  Form,
  Input,
  Select,
  Button,
  Table,
  message,
  Modal,
  Alert,
  Descriptions,
  InputNumber,
  Popover,
  Space,
  Popconfirm,
  Tag,
} from 'antd'
import dayjs from 'dayjs'
import { PlusOutlined, LineChartOutlined, EditOutlined, FormOutlined, UndoOutlined } from '@ant-design/icons'
import { API_BASE_URL } from '../../api/axios'
import { dashboardApi } from '../../api/dashboard'
import { storage } from '../../utils/storage'
import {
  invalidateAfterPerformanceNaChange,
  sessionApiCacheGet,
} from '../../utils/sessionApiCache'
import { sortPerformanceRefOptions } from '../../utils/performanceRefs'
import { TableWithSkeletonLoading } from '../../components/common/skeletons'
import { OperationsSectionTabs } from '../../components/common/OperationsSectionTabs'
import { useSearchParams } from 'react-router-dom'
const { Title, Text } = Typography

/* List endpoint batches Supabase calls; allow headroom for cold DB / network. */
const FETCH_TIMEOUT_MS = 45000

function toDateInputValue(value: unknown): string | undefined {
  if (value == null || value === '') return undefined
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1]
}

function yesNoValue(value: unknown): 'yes' | 'no' {
  return String(value ?? 'no').trim().toLowerCase() === 'yes' ? 'yes' : 'no'
}

interface Company {
  id: string
  name: string
}

interface FeatureOption {
  id: string
  name: string
  display_order?: number
}
type ListPayload<T> = T[] | { data?: T[]; items?: T[] }

/** API: exclude_na = Active list; only_na = NA-marked (restore here). */
type PerformanceNaFilter = 'exclude_na' | 'only_na'

interface POCItem {
  id: string
  company_id?: string
  reference_no: string
  company_name: string
  message_owner: string
  response?: string
  contact?: string
  completion_status: string
  created_at: string
  total_percentage?: number | null
  has_training?: boolean
  feature_count?: number
  current_stage?: string
  marked_na?: boolean
  company_excluded_by_na?: boolean
}

interface TicketDetails {
  id: string
  company_id?: string
  reference_no: string
  company_name: string
  message_owner: string
  response?: string
  contact?: string
  completion_status: string
  total_percentage?: number | null
  current_stage: string
  pending_features: string[]
  marked_na?: boolean
  company_excluded_by_na?: boolean
  training?: Record<string, unknown>
  feature_ids: string[]
  features_locked?: boolean
  features_with_followups?: Array<{
    ticket_feature_id: string
    feature_name: string
    status: string
    followups: Array<Record<string, unknown>>
  }>
}

interface FollowupFeature {
  ticket_feature_id: string
  feature_id: string
  feature_name: string
  status: string
  followups: Array<{
    id: string
    previous_percentage?: number
    added_percentage?: number
    total_percentage?: number
    status: string
    remarks?: string
    created_at: string
    can_revert?: boolean
  }>
}

function formatFollowupHistoryLine(fu: {
  previous_percentage?: number | null
  added_percentage?: number | null
  total_percentage?: number | null
  status?: string
  remarks?: string | null
  created_at?: string | null
}): string {
  const ts = fu.created_at ? dayjs(fu.created_at).format('YYYY-MM-DD HH:mm:ss') : ''
  const base = `Prev: ${fu.previous_percentage}% → +${fu.added_percentage}% = ${fu.total_percentage}% (${fu.status})`
  return `${base}${ts ? ` — ${ts}` : ''}${fu.remarks ? ` - ${fu.remarks}` : ''}`
}

export const PerformanceMonitoringPage = () => {
  const [searchParams] = useSearchParams()
  const [form] = Form.useForm()
  const [trainingForm] = Form.useForm()
  const [followupForm] = Form.useForm()
  const [companies, setCompanies] = useState<Company[]>([])
  const [items, setItems] = useState<POCItem[]>([])
  const [features, setFeatures] = useState<FeatureOption[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formModalOpen, setFormModalOpen] = useState(false)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [trainingModalOpen, setTrainingModalOpen] = useState(false)
  const [followupModalOpen, setFollowupModalOpen] = useState(false)
  /** Set when a follow-up is added inside the open modal; the heavy list reload is deferred to modal close so scroll position is kept. */
  const followupListDirtyRef = useRef(false)
  const [selectedItem, setSelectedItem] = useState<POCItem | null>(null)
  const [setupError, setSetupError] = useState<string | null>(null)
  const activeTab = 'active'
  const [followupData, setFollowupData] = useState<{ features: FollowupFeature[]; total_percentage: number | null; initial_percentage: number | null; is_first_followup: boolean }>({ features: [], total_percentage: null, initial_percentage: null, is_first_followup: false })
  const [followupSubmitting, setFollowupSubmitting] = useState(false)
  const [followupClicksByTf, setFollowupClicksByTf] = useState<
    Record<string, { count: number; events: Array<{ id: string; clicked_at: string }> }>
  >({})
  const openedDeepLinkRef = useRef('')
  const [featuresLocked, setFeaturesLocked] = useState(false)
  const [detailsData, setDetailsData] = useState<TicketDetails | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [filterRef, setFilterRef] = useState<string>('')
  const [filterCompany, setFilterCompany] = useState<string>('')
  const [filterNa, setFilterNa] = useState<PerformanceNaFilter>('exclude_na')
  const [markedNaSupported, setMarkedNaSupported] = useState(false)
  const [naCompanyIds, setNaCompanyIds] = useState<Set<string>>(new Set())
  const [naTogglingId, setNaTogglingId] = useState<string | null>(null)

  const canRestoreCompany = (record: POCItem) =>
    markedNaSupported &&
    Boolean(record.company_id) &&
    (record.company_excluded_by_na || record.marked_na) &&
    filterNa === 'only_na'

  const fetchWithTimeout = (url: string, options: RequestInit = {}) => {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id))
  }

  const getAuthHeaders = () => ({
    Authorization: `Bearer ${storage.getToken() ?? ''}`,
  })
  const getAuthHeadersWithJson = () => ({
    Authorization: `Bearer ${storage.getToken() ?? ''}`,
    'Content-Type': 'application/json',
  })

  const loadCapabilities = async () => {
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/success/performance/capabilities`, {
        headers: getAuthHeaders(),
      })
      if (res.ok) {
        const data = (await res.json()) as { marked_na_supported?: boolean; hint?: string }
        setMarkedNaSupported(Boolean(data.marked_na_supported))
        if (!data.marked_na_supported && data.hint) {
          message.warning(data.hint, 8)
        }
      }
    } catch {
      /* list load will also set marked_na_supported */
    }
  }

  useEffect(() => {
    loadCompanies()
    loadFeatures()
    void loadNaCompanyIds()
    void loadCapabilities()
  }, [])

  useEffect(() => {
    loadItems()
  }, [filterNa])

  const loadFollowupClicksForTfIds = async (tfIds: string[]) => {
    if (!tfIds.length) {
      setFollowupClicksByTf({})
      return
    }
    const entries = await Promise.all(
      tfIds.map(async (tfId) => {
        try {
          const r = await fetchWithTimeout(
            `${API_BASE_URL}/success/performance/followup-clicks?ticket_feature_id=${encodeURIComponent(tfId)}`,
            { headers: getAuthHeaders() }
          )
          if (r.ok) {
            const j = (await r.json()) as { count?: number; events?: Array<{ id: string; clicked_at: string }> }
            return [tfId, { count: j.count ?? 0, events: j.events ?? [] }] as const
          }
        } catch {
          /* ignore */
        }
        return [tfId, { count: 0, events: [] }] as const
      })
    )
    setFollowupClicksByTf(Object.fromEntries(entries))
  }

  const refreshClicksForTf = async (tfId: string) => {
    try {
      const r = await fetchWithTimeout(
        `${API_BASE_URL}/success/performance/followup-clicks?ticket_feature_id=${encodeURIComponent(tfId)}`,
        { headers: getAuthHeaders() }
      )
      if (r.ok) {
        const j = (await r.json()) as { count?: number; events?: Array<{ id: string; clicked_at: string }> }
        setFollowupClicksByTf((prev) => ({
          ...prev,
          [tfId]: { count: j.count ?? 0, events: j.events ?? [] },
        }))
      }
    } catch {
      /* ignore */
    }
  }

  const loadCompanies = async () => {
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/companies`, { headers: getAuthHeaders() })
      if (res.ok) {
        const payload = (await res.json()) as ListPayload<Company>
        const rows = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload?.items)
              ? payload.items
              : []
        setCompanies(rows)
      } else {
        setCompanies([])
      }
    } catch {
      setCompanies([])
      message.error('Failed to load companies')
    }
  }

  const loadFeatures = async () => {
    try {
      const data = await dashboardApi.getSuccessPerformanceFeatures()
      setFeatures(data.items || [])
    } catch {
      message.error('Failed to load features')
    }
  }

  const loadNaCompanyIds = async () => {
    try {
      const data = await dashboardApi.getSuccessPerformanceNaCompanyIds()
      setNaCompanyIds(new Set(data.company_ids || []))
    } catch {
      /* ignore */
    }
  }

  const loadItems = async (
    naOverride?: PerformanceNaFilter,
    options?: { skipCache?: boolean; backgroundRefresh?: boolean },
  ) => {
    setSetupError(null)
    const status = 'in_progress'
    const naParam = naOverride ?? filterNa ?? 'exclude_na'
    const cacheKey = `dashboard:success-performance-list:${status}:${naParam}`
    // Background refresh (e.g. after Add Follow Up in an open modal): keep the
    // current list mounted and preserve scroll instead of showing the skeleton.
    const backgroundRefresh = !!options?.backgroundRefresh
    const scrollY = backgroundRefresh && typeof window !== 'undefined' ? window.scrollY : 0
    const restoreScroll = () => {
      if (!backgroundRefresh || typeof window === 'undefined') return
      window.scrollTo({ top: scrollY })
      requestAnimationFrame(() => window.scrollTo({ top: scrollY }))
    }
    const cached =
      !options?.skipCache
        ? sessionApiCacheGet<{ items?: POCItem[]; marked_na_supported?: boolean }>(cacheKey)
        : null
    if (cached?.items?.length) {
      setItems(cached.items as POCItem[])
      if (cached.marked_na_supported === true) setMarkedNaSupported(true)
      else if (cached.marked_na_supported === false) setMarkedNaSupported(false)
      setLoading(false)
    } else if (!backgroundRefresh) {
      setLoading(true)
    }
    try {
      const data = await dashboardApi.getSuccessPerformanceList(status, {
        naFilter: naParam,
        skipCache: options?.skipCache,
        backgroundRefresh,
      })
      if (data.marked_na_supported === true) {
        setMarkedNaSupported(true)
      } else if (data.marked_na_supported === false) {
        setMarkedNaSupported(false)
      }
      setItems((data.items || []) as POCItem[])
      restoreScroll()
    } catch (e) {
      setItems([])
      const ax = e as { response?: { status?: number; data?: { detail?: string } } }
      if (ax.response?.status === 503) {
        setSetupError(ax.response?.data?.detail || 'Database tables not set up.')
      } else if (ax.response?.status === 401) {
        setSetupError('Please log in again to load the list.')
      } else {
        setSetupError(ax.response?.data?.detail || 'Failed to load. Run database/SUCCESS_PERFORMANCE_MONITORING.sql in Supabase.')
      }
    } finally {
      setLoading(false)
    }
  }

  const openTrainingModal = (record: POCItem) => {
    setSelectedItem(record)
    setFeaturesLocked(false)
    trainingForm.resetFields()
    setTrainingModalOpen(true)
  }

  const loadTrainingIntoForm = async (ticketId: string) => {
    try {
      const res = await fetchWithTimeout(
        `${API_BASE_URL}/success/performance/training?ticket_id=${ticketId}`,
        { headers: getAuthHeaders() },
      )
      if (!res.ok) {
        message.error('Failed to load training data')
        return
      }
      const data = await res.json()
      const t = data.training as Record<string, unknown> | null | undefined
      setFeaturesLocked(Boolean(data.features_locked))
      if (t) {
        trainingForm.setFieldsValue({
          call_poc: yesNoValue(t.call_poc),
          message_poc: yesNoValue(t.message_poc),
          message_owner: yesNoValue(t.message_owner),
          training_schedule_date: toDateInputValue(t.training_schedule_date),
          training_status: yesNoValue(t.training_status),
          remarks: t.remarks ?? '',
          feature_ids: Array.isArray(data.feature_ids) ? data.feature_ids : [],
        })
      } else {
        trainingForm.setFieldsValue({
          call_poc: 'no',
          message_poc: 'no',
          message_owner: 'no',
          training_status: 'no',
          training_schedule_date: undefined,
          remarks: '',
          feature_ids: [],
        })
      }
    } catch {
      message.error('Failed to load training data')
    }
  }

  const openFollowupModal = async (record: POCItem) => {
    setSelectedItem(record)
    setFollowupModalOpen(true)
    setFollowupClicksByTf({})
    setFollowupData({ features: [], total_percentage: null, initial_percentage: null, is_first_followup: false })
    try {
      const res = await fetchWithTimeout(
        `${API_BASE_URL}/success/performance/followups?ticket_id=${record.id}`,
        { headers: getAuthHeaders() }
      )
      if (res.ok) {
        const data = await res.json()
        const feats = (data.features || []) as FollowupFeature[]
        setFollowupData({
          features: feats,
          total_percentage: data.total_percentage ?? null,
          initial_percentage: data.initial_percentage ?? null,
          is_first_followup: data.is_first_followup ?? false,
        })
        const lastTotal = data.total_percentage ?? 0
        followupForm.setFieldsValue({
          status: 'pending',
          remarks: '',
          ticket_feature_ids: [],
          previous_percentage: lastTotal,
          initial_percentage: data.initial_percentage ?? '',
        })
        await loadFollowupClicksForTfIds(feats.map((f) => f.ticket_feature_id))
      }
    } catch {
      message.error('Failed to load followup data')
    }
  }

  const onFinish = async (values: {
    company_id: string
    message_owner: 'yes' | 'no'
    response: string
    contact: string
  }) => {
    setSubmitting(true)
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/success/performance/poc`, {
        method: 'POST',
        headers: getAuthHeadersWithJson(),
        body: JSON.stringify(values),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.id) {
        message.success(`POC created: ${data.reference_no}`)
        form.resetFields()
        setFormModalOpen(false)
        invalidateAfterPerformanceNaChange()
        loadItems(undefined, { skipCache: true })
      } else {
        message.error(data?.detail || 'Failed to create POC')
      }
    } catch {
      message.error('Failed to create POC.')
    } finally {
      setSubmitting(false)
    }
  }

  const onTrainingFinish = async (values: {
    call_poc: string
    message_poc: string
    message_owner: string
    training_schedule_date?: string
    training_status: string
    remarks?: string
    feature_ids: string[]
  }) => {
    if (!selectedItem) return
    setSubmitting(true)
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/success/performance/training`, {
        method: 'POST',
        headers: getAuthHeadersWithJson(),
        body: JSON.stringify({
          ticket_id: selectedItem.id,
          call_poc: values.call_poc,
          message_poc: values.message_poc,
          message_owner: values.message_owner,
          training_schedule_date: values.training_schedule_date || null,
          training_status: values.training_status,
          remarks: values.remarks || null,
          feature_ids: values.feature_ids || [],
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        if (data.features_locked != null) setFeaturesLocked(data.features_locked)
        message.success('Training saved.')
        setTrainingModalOpen(false)
        invalidateAfterPerformanceNaChange()
        loadItems(undefined, { skipCache: true })
      } else {
        message.error((data as { detail?: string })?.detail || 'Failed to save training')
      }
    } catch {
      message.error('Failed to save training')
    } finally {
      setSubmitting(false)
    }
  }

  const reloadFollowupModalData = async () => {
    if (!selectedItem) return
    const r = await fetchWithTimeout(
      `${API_BASE_URL}/success/performance/followups?ticket_id=${selectedItem.id}`,
      { headers: getAuthHeaders() },
    )
    if (!r.ok) return
    const j = await r.json()
    const feats = (j.features || []) as FollowupFeature[]
    setFollowupData({
      features: feats,
      total_percentage: j.total_percentage ?? null,
      initial_percentage: j.initial_percentage ?? followupData.initial_percentage,
      is_first_followup: j.is_first_followup ?? false,
    })
    followupForm.setFieldsValue({ previous_percentage: j.total_percentage ?? 0 })
    await loadFollowupClicksForTfIds(feats.map((f) => f.ticket_feature_id))
  }

  const revertFollowup = async (followupId: string) => {
    setFollowupSubmitting(true)
    try {
      const res = await fetchWithTimeout(
        `${API_BASE_URL}/success/performance/followup/${encodeURIComponent(followupId)}/revert`,
        { method: 'POST', headers: getAuthHeaders() },
      )
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        message.success(`Followup reverted. Total: ${data.total_percentage}%`)
        await reloadFollowupModalData()
        invalidateAfterPerformanceNaChange()
        followupListDirtyRef.current = true
      } else {
        message.error(data?.detail || 'Could not revert followup')
      }
    } catch {
      message.error('Could not revert followup')
    } finally {
      setFollowupSubmitting(false)
    }
  }

  const submitFollowup = async (ticketFeatureIds: string[]) => {
    if (!selectedItem || ticketFeatureIds.length === 0) return
    followupForm.setFieldsValue({ previous_percentage: followupData.total_percentage ?? 0 })
    const values = await followupForm.validateFields().catch(() => null)
    if (!values) return
    const status = values.status || 'pending'
    const ids = [...new Set(ticketFeatureIds)]
    setFollowupSubmitting(true)
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/success/performance/followup-batch`, {
        method: 'POST',
        headers: getAuthHeadersWithJson(),
        body: JSON.stringify({
          ticket_id: selectedItem.id,
          ticket_feature_ids: ids,
          initial_percentage: followupData.is_first_followup ? Number(values.initial_percentage) : undefined,
          status,
          remarks: values.remarks || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        const n = data.count ?? ids.length
        message.success(`Followup saved for ${n} feature${n === 1 ? '' : 's'}. Total: ${data.total_percentage}%`)
        followupForm.setFieldsValue({ previous_percentage: data.total_percentage, ticket_feature_ids: [] })
        setFollowupData((d) => ({ ...d, total_percentage: data.total_percentage, is_first_followup: false }))
        await reloadFollowupModalData()
        invalidateAfterPerformanceNaChange()
        followupListDirtyRef.current = true
      } else {
        message.error(data?.detail || 'Failed to save followup')
      }
    } catch {
      message.error('Failed to save followup')
    } finally {
      setFollowupSubmitting(false)
    }
  }

  /** Log KPI clicks for non-completed features, then submit follow-up batch. */
  const onAddFollowupForFeatures = async (ticketFeatureIds: string[]) => {
    if (!selectedItem || ticketFeatureIds.length === 0) {
      message.warning('Select at least one feature')
      return
    }
    const pendingFeatures = followupData.features.filter(
      (f) => ticketFeatureIds.includes(f.ticket_feature_id) && String(f.status).toLowerCase() !== 'completed',
    )
    for (const f of pendingFeatures) {
      try {
        const res = await fetchWithTimeout(`${API_BASE_URL}/success/performance/followup-click`, {
          method: 'POST',
          headers: getAuthHeadersWithJson(),
          body: JSON.stringify({
            ticket_id: selectedItem.id,
            ticket_feature_id: f.ticket_feature_id,
          }),
        })
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { detail?: string }
          message.warning(data?.detail || 'Could not log follow-up click for KPI. Follow-up may still save.')
        }
      } catch {
        message.warning('Could not log follow-up click for KPI.')
      }
      await refreshClicksForTf(f.ticket_feature_id)
    }
    await submitFollowup(ticketFeatureIds)
  }

  const toggleMarkedNa = async (record: POCItem, marked: boolean) => {
    if (!markedNaSupported) {
      message.warning('Run database/PERFORMANCE_MONITORING_MARKED_NA.sql in Supabase first.')
      return
    }
    setNaTogglingId(record.id)
    try {
      const res = await fetchWithTimeout(
        `${API_BASE_URL}/success/performance/${record.id}/marked-na`,
        {
          method: 'PATCH',
          headers: getAuthHeadersWithJson(),
          body: JSON.stringify({ marked_na: marked }),
        },
      )
      const data = (await res.json().catch(() => ({}))) as { detail?: string }
      if (res.ok) {
        message.success(
          marked ? 'Marked NA — moved to NA list (hidden from KPIs)' : 'Restored — company is Active again',
        )
        invalidateAfterPerformanceNaChange()
        if (!marked) {
          setFilterNa('exclude_na')
          await loadItems('exclude_na', { skipCache: true })
        } else {
          await loadItems(undefined, { skipCache: true })
        }
        await loadNaCompanyIds()
      } else {
        message.error(data?.detail || 'Failed to update NA')
      }
    } catch {
      message.error('Failed to update NA')
    } finally {
      setNaTogglingId(null)
    }
  }

  const restoreCompanyFromNa = async (record: POCItem) => {
    const companyId = record.company_id
    if (!companyId || !markedNaSupported) {
      message.warning('Run database/PERFORMANCE_MONITORING_MARKED_NA.sql in Supabase first.')
      return
    }
    setNaTogglingId(companyId)
    try {
      const res = await fetchWithTimeout(
        `${API_BASE_URL}/success/performance/company/${encodeURIComponent(companyId)}/restore-na`,
        { method: 'PATCH', headers: getAuthHeadersWithJson() },
      )
      const data = (await res.json().catch(() => ({}))) as { detail?: string; restored_count?: number; company_name?: string }
      if (res.ok) {
        const n = data.restored_count ?? 0
        message.success(
          n > 0
            ? `Restored ${data.company_name || record.company_name || 'company'} (${n} response${n === 1 ? '' : 's'}) — visible in KPIs and lists again`
            : `Restored ${data.company_name || record.company_name || 'company'}`,
        )
        invalidateAfterPerformanceNaChange()
        setDetailModalOpen(false)
        setFilterNa('exclude_na')
        await loadNaCompanyIds()
        await loadItems('exclude_na', { skipCache: true })
      } else {
        message.error(data?.detail || 'Failed to restore company')
      }
    } catch {
      message.error('Failed to restore company')
    } finally {
      setNaTogglingId(null)
    }
  }

  const openViewDetails = async (record: POCItem) => {
    setSelectedItem(record)
    setDetailModalOpen(true)
    const cacheKey = `success:performance-details:${record.id}`
    const cached = sessionApiCacheGet<Record<string, unknown>>(cacheKey)
    setDetailsData(cached ?? null)
    setDetailsLoading(!cached)
    try {
      const data = (await dashboardApi.getSuccessPerformanceDetails(record.id)) as TicketDetails
      setDetailsData(data)
    } catch (err) {
      const ax = err as { response?: { data?: { detail?: string } } }
      const detail = ax.response?.data?.detail
      if (!cached) {
        setDetailsData({
          id: record.id,
          reference_no: record.reference_no,
          company_name: record.company_name,
          message_owner: record.message_owner,
          response: record.response,
          contact: record.contact,
          completion_status: record.completion_status,
          total_percentage: record.total_percentage ?? undefined,
          current_stage: record.current_stage || '—',
          pending_features: [],
          feature_ids: [],
        })
        message.warning(detail ? String(detail).slice(0, 200) : 'Showing summary only; full details could not be loaded.')
      } else if (detail) {
        message.warning(String(detail).slice(0, 200))
      }
    } finally {
      setDetailsLoading(false)
    }
  }

  useEffect(() => {
    const target = (searchParams.get('open') || searchParams.get('reference') || '').trim()
    if (!target || openedDeepLinkRef.current === target || detailModalOpen || !items.length) return
    const record = items.find((row) => row.id === target || row.reference_no === target)
    if (!record) return
    openedDeepLinkRef.current = target
    void openViewDetails(record)
  }, [detailModalOpen, items, searchParams])

  const renderActionNaControls = (record: POCItem) => {
    if (canRestoreCompany(record)) {
      return (
        <Popconfirm
          title={`Restore ${record.company_name || 'this company'}?`}
          onConfirm={() => void restoreCompanyFromNa(record)}
          okText="Restore"
        >
          <Button
            type="link"
            size="small"
            icon={<UndoOutlined />}
            loading={naTogglingId === record.company_id}
            onClick={(e) => e.stopPropagation()}
          >
            Restore
          </Button>
        </Popconfirm>
      )
    }
    if (filterNa !== 'only_na' && !record.marked_na && !record.company_excluded_by_na) {
      return (
        <Popconfirm
          title="Mark NA? Company will be hidden from all Success pages and KPI."
          onConfirm={() => {
            if (!markedNaSupported) {
              message.warning('Run STEP 0 + NOTIFY pgrst in Supabase, restart backend, then refresh.')
              void loadCapabilities()
              return
            }
            void toggleMarkedNa(record, true)
          }}
          okText="NA"
        >
          <span onClick={(e) => e.stopPropagation()}>
            <Button
              type="link"
              size="small"
              danger
              loading={naTogglingId === record.id}
              title={markedNaSupported ? 'Not required — exclude from KPI' : 'Run marked_na migration + schema reload in Supabase'}
            >
              NA
            </Button>
          </span>
        </Popconfirm>
      )
    }
    if (record.marked_na || record.company_excluded_by_na) {
      return (
        <Tag color="orange" style={{ margin: 0 }}>
          NA
        </Tag>
      )
    }
    return null
  }

  const renderRowActions = (record: POCItem) => {
    const isActiveRow = filterNa !== 'only_na' && !record.marked_na && !record.company_excluded_by_na
    return (
      <Space size={[4, 4]} wrap align="center" onClick={(e) => e.stopPropagation()}>
        {isActiveRow && (
          <>
            <Button
              size="small"
              icon={<FormOutlined />}
              onClick={() => void openTrainingModal(record)}
            >
              {record.has_training ? 'Edit Training' : 'Training'}
            </Button>
            {(record.feature_count ?? 0) > 0 && (
              <Button size="small" onClick={() => void openFollowupModal(record)}>
                Followup
              </Button>
            )}
          </>
        )}
        {renderActionNaControls(record)}
      </Space>
    )
  }

  const tableColumns = [
    { title: 'Reference Number', dataIndex: 'reference_no', key: 'reference_no', width: 108, ellipsis: true },
    {
      title: 'Company Name',
      dataIndex: 'company_name',
      key: 'company_name',
      width: 168,
      ellipsis: true,
    },
    {
      title: 'Response',
      dataIndex: 'response',
      key: 'response',
      width: 132,
      ellipsis: true,
      render: (v: string) => (v ? String(v).slice(0, 36) + (String(v).length > 36 ? '…' : '') : '-'),
    },
    {
      title: 'Contact',
      dataIndex: 'contact',
      key: 'contact',
      width: 108,
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: 'Total Completion %',
      dataIndex: 'total_percentage',
      key: 'total_percentage',
      width: 108,
      render: (v: number | null | undefined) => (v != null ? `${Number(v)}%` : '-'),
    },
    {
      title: 'Current Stage',
      dataIndex: 'current_stage',
      key: 'current_stage',
      ellipsis: true,
      render: (v: string) => {
        const text = (v || '').trim() || '-'
        const words = text.split(/\s+/).filter(Boolean)
        const maxWords = 25
        const truncated = words.length <= maxWords ? text : words.slice(0, maxWords).join(' ') + '...'
        if (words.length <= maxWords) {
          return <span style={{ wordBreak: 'break-word' }}>{text}</span>
        }
        return (
          <Popover
            content={<div style={{ maxWidth: 360, wordBreak: 'break-word' }}>{text}</div>}
            title="Current Stage (full)"
            trigger="click"
          >
            <span
              style={{ cursor: 'pointer', textDecoration: 'underline', wordBreak: 'break-word' }}
              onClick={(e) => e.stopPropagation()}
            >
              {truncated}
            </span>
          </Popover>
        )
      },
    },
    {
      title: 'Action',
      key: 'action',
      width: 220,
      fixed: 'right' as const,
      render: (_: unknown, record: POCItem) => renderRowActions(record),
    },
  ]

  // Render the full filtered list directly (no scroll-triggered auto-loading).
  // Auto-loading on scroll caused the list to reset/jump to the top.
  const openFollowupFeatureOptions = useMemo(
    () =>
      followupData.features
        .filter((f) => String(f.status).toLowerCase() !== 'completed')
        .map((f) => ({ value: f.ticket_feature_id, label: f.feature_name })),
    [followupData.features],
  )

  const hasOpenFollowupFeatures = openFollowupFeatureOptions.length > 0

  const displayItems = useMemo(
    () =>
      items.filter((i) => {
        if (filterRef && !String(i.reference_no || '').toLowerCase().includes(filterRef.toLowerCase())) return false
        if (filterCompany && !String(i.company_name || '').toLowerCase().includes(filterCompany.toLowerCase())) return false
        return true
      }),
    [items, filterRef, filterCompany],
  )
  const visibleDisplayItems = displayItems
  const totalDisplayItems = displayItems.length

  return (
    <div>
      <Space style={{ marginBottom: 24 }} wrap align="center">
        <Title level={4} className="page-main-heading" style={{ margin: 0 }}>
          <LineChartOutlined style={{ marginRight: 8 }} />
          Performance Monitoring
        </Title>
        <OperationsSectionTabs module="success" />
      </Space>

      <Card style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setFormModalOpen(true)}>
            Add POC Details
          </Button>
          <Select
            value={filterNa}
            onChange={(v) => setFilterNa((v as PerformanceNaFilter) || 'exclude_na')}
            style={{ minWidth: 160 }}
            options={[
              { value: 'exclude_na', label: 'Active' },
              { value: 'only_na', label: 'NA' },
            ]}
          />
          {!markedNaSupported ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Run <Text code>database/PERFORMANCE_MONITORING_MARKED_NA.sql</Text> in Supabase to enable NA.
            </Text>
          ) : null}
        </div>
      </Card>

      {setupError && (
        <Alert type="warning" message="Setup Required" description={setupError} showIcon style={{ marginBottom: 16 }} />
      )}

      <Card>
        <div style={{ marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <Select
            placeholder="Filter by Reference"
            value={filterRef || undefined}
            onChange={(v) => setFilterRef(v ?? '')}
            style={{ width: 200 }}
            allowClear
            showSearch
            optionFilterProp="label"
            options={sortPerformanceRefOptions([...new Set(items.map((i) => i.reference_no).filter(Boolean))] as string[]).map((r) => ({
              value: r,
              label: r,
            }))}
          />
          <Select
            placeholder="Filter by Company"
            value={filterCompany || undefined}
            onChange={(v) => setFilterCompany(v ?? '')}
            style={{ width: 240 }}
            allowClear
            showSearch
            optionFilterProp="label"
            options={[...new Set(items.map((i) => i.company_name).filter(Boolean))].sort().map((c) => ({ value: c, label: c }))}
          />
        </div>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
          Use <strong>Action</strong> for Training, Followup, and NA. Click a row elsewhere for full details.{' '}
          <strong>Active</strong> / <strong>NA</strong> filter above; Restore moves a company back to Active.
        </Typography.Text>
        <div>
          <TableWithSkeletonLoading loading={loading} columns={7} rows={12}>
            <Table
              className="performance-monitoring-table"
              dataSource={visibleDisplayItems}
              rowKey="id"
              loading={false}
              tableLayout="fixed"
              scroll={{ x: 980 }}
              onRow={(record) => ({
                onClick: () => openViewDetails(record),
                style: { cursor: 'pointer' },
              })}
              columns={tableColumns}
              pagination={false}
              locale={{
                emptyText: !loading && !setupError
                  ? filterNa === 'only_na'
                    ? 'No NA tickets. Mark NA on Active tickets when follow-up is not required.'
                    : 'No active companies. Use "Add POC Details" above to add one, or see Comp-Perform for completed companies.'
                  : undefined,
              }}
            />
          </TableWithSkeletonLoading>
          {totalDisplayItems > 0 && (
            <div style={{ marginTop: 12, color: '#8c8c8c', fontSize: 13 }}>
              {totalDisplayItems} {totalDisplayItems === 1 ? 'record' : 'records'}
            </div>
          )}
        </div>
      </Card>

      <Modal
        title="Add POC Details"
        open={formModalOpen}
        onCancel={() => { setFormModalOpen(false); form.resetFields() }}
        footer={null}
        destroyOnClose
        width={560}
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="company_id" label="Company Name" rules={[{ required: true, message: 'Select company' }]}>
            <Select
              placeholder="Select company"
              options={companies
                .filter((c) => !naCompanyIds.has(c.id))
                .map((c) => ({ value: c.id, label: c.name }))}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item name="message_owner" label="Message Owner" rules={[{ required: true }]} initialValue="no">
            <Select options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
          </Form.Item>
          <Form.Item name="response" label="Response *" rules={[{ required: true, message: 'Required' }]}>
            <Input.TextArea rows={3} placeholder="Response" />
          </Form.Item>
          <Form.Item name="contact" label="Contact *" rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="Contact" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting} icon={<PlusOutlined />}>
              Add POC Details
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={selectedItem?.has_training ? `Edit Training - ${selectedItem?.reference_no}` : `Training - ${selectedItem?.reference_no}`}
        open={trainingModalOpen}
        onCancel={() => { setTrainingModalOpen(false); setSelectedItem(null) }}
        afterOpenChange={(open) => {
          if (open && selectedItem?.id) void loadTrainingIntoForm(selectedItem.id)
        }}
        footer={null}
        destroyOnClose
        width={560}
      >
        {selectedItem && (
          <Form form={trainingForm} layout="vertical" onFinish={onTrainingFinish}>
            <Form.Item name="call_poc" label="Call POC" rules={[{ required: true }]} initialValue="no">
              <Select options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
            </Form.Item>
            <Form.Item name="message_poc" label="Message POC" rules={[{ required: true }]} initialValue="no">
              <Select options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
            </Form.Item>
            <Form.Item name="message_owner" label="Message Owner" rules={[{ required: true }]} initialValue="no">
              <Select options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
            </Form.Item>
            <Form.Item name="training_schedule_date" label="Training Schedule Date *" rules={[{ required: true, message: 'Required' }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="training_status" label="Training Status" rules={[{ required: true }]} initialValue="no">
              <Select options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
            </Form.Item>
            <Form.Item name="remarks" label="Remarks">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item
              name="feature_ids"
              label="Feature Committed for Use *"
              rules={[{ required: !featuresLocked, message: 'Required (locked after 144 hr)' }]}
              help={undefined}
            >
              <Select
                mode="multiple"
                placeholder="Select features"
                options={features.map((f) => ({ value: f.id, label: f.name }))}
                optionFilterProp="label"
                disabled={featuresLocked}
              />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={submitting}>
                Submit
              </Button>
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title={`Followup - ${selectedItem?.reference_no}`}
        open={followupModalOpen}
        onCancel={() => {
          setFollowupModalOpen(false)
          setSelectedItem(null)
          if (followupListDirtyRef.current) {
            followupListDirtyRef.current = false
            loadItems(undefined, { skipCache: true, backgroundRefresh: true })
          }
        }}
        footer={null}
        width={640}
      >
        {followupData.total_percentage != null && (
          <p><strong>Total Completion: {followupData.total_percentage}%</strong></p>
        )}
        <Form form={followupForm} layout="vertical" initialValues={{ status: 'pending', previous_percentage: 0, initial_percentage: '', ticket_feature_ids: [] }}>
          {followupData.is_first_followup && (
            <Form.Item
              name="initial_percentage"
              label="Initial % (1st time only) *"
              rules={[{ required: true, message: 'Enter base % already completed' }]}
              help="Enter the percentage you have already completed. Remaining (100 - this) will be divided equally among features."
            >
              <InputNumber min={0} max={100} step={0.01} style={{ width: 120 }} placeholder="e.g. 20" />
            </Form.Item>
          )}
          <Form.Item
            name="previous_percentage"
            label="Current total %"
            help="Calculated from server. New total = this + feature share when marked Completed."
          >
            <InputNumber min={0} max={100} step={0.01} style={{ width: 120 }} readOnly controls={false} />
          </Form.Item>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <Form.Item name="status" label="Status *" rules={[{ required: true }]} style={{ marginBottom: 8 }}>
              <Select
                style={{ width: 108 }}
                options={[{ value: 'pending', label: 'Pending' }, { value: 'completed', label: 'Completed' }]}
              />
            </Form.Item>
            <Form.Item
              name="ticket_feature_ids"
              label="Feature Committed for Use *"
              rules={[{ required: true, message: 'Select at least one feature' }]}
              style={{ flex: 1, minWidth: 220, marginBottom: 8 }}
            >
              <Select
                mode="multiple"
                placeholder="Select features"
                options={openFollowupFeatureOptions}
                optionFilterProp="label"
                maxTagCount="responsive"
                disabled={!hasOpenFollowupFeatures}
              />
            </Form.Item>
          </div>
          <Form.Item name="remarks" label="Remarks">
            <Input.TextArea rows={1} />
          </Form.Item>
          {hasOpenFollowupFeatures && (
            <Form.Item style={{ marginBottom: 16 }}>
              <Button
                type="primary"
                loading={followupSubmitting}
                onClick={() => {
                  const ids = (followupForm.getFieldValue('ticket_feature_ids') || []) as string[]
                  void onAddFollowupForFeatures(ids)
                }}
              >
                Add followup for selected features
              </Button>
            </Form.Item>
          )}
        </Form>
        {followupData.features.map((f) => (
          <Card key={f.ticket_feature_id} size="small" title={f.feature_name} style={{ marginBottom: 8 }}>
            <div>Status: {f.status}</div>
            {f.followups.length > 0 && (
              <ul style={{ marginTop: 4, paddingLeft: 16 }}>
                {f.followups.map((fu) => (
                  <li
                    key={fu.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexWrap: 'wrap',
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 220 }}>{formatFollowupHistoryLine(fu)}</span>
                    {fu.can_revert && fu.status === 'completed' && (
                      <Popconfirm
                        title="Revert this Completed followup?"
                        description="Within 24 hours only. Feature returns to Pending and total % is recalculated."
                        onConfirm={() => void revertFollowup(fu.id)}
                        okText="Back"
                        cancelText="Cancel"
                      >
                        <Button
                          type="link"
                          size="small"
                          icon={<UndoOutlined />}
                          loading={followupSubmitting}
                          style={{ padding: 0, height: 'auto' }}
                        >
                          Back
                        </Button>
                      </Popconfirm>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {f.status !== 'Completed' && (followupClicksByTf[f.ticket_feature_id]?.count ?? 0) > 0 && (
              <div style={{ marginTop: 8 }}>
                <Popover
                  title="Follow-up button clicks (KPI)"
                  content={
                    (followupClicksByTf[f.ticket_feature_id]?.events?.length ?? 0) === 0 ? (
                      <Text type="secondary">No clicks logged yet for this feature.</Text>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 16, maxHeight: 260, overflow: 'auto', maxWidth: 280 }}>
                        {(followupClicksByTf[f.ticket_feature_id]?.events ?? []).map((e) => (
                          <li key={e.id}>{dayjs(e.clicked_at).format('YYYY-MM-DD HH:mm:ss')}</li>
                        ))}
                      </ul>
                    )
                  }
                >
                  <Button size="small" type="default" title="KPI follow-up click count">
                    KPI clicks: {followupClicksByTf[f.ticket_feature_id]?.count ?? 0}
                  </Button>
                </Popover>
              </div>
            )}
          </Card>
        ))}
      </Modal>

      <Modal
        title={`View Details - ${selectedItem?.reference_no || ''}`}
        open={detailModalOpen}
        onCancel={() => { setDetailModalOpen(false); setSelectedItem(null); setDetailsData(null) }}
        footer={null}
        width={640}
      >
        {selectedItem && (
          <>
            {detailsLoading ? (
              <>
                <p>Loading...</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
                  {filterNa !== 'only_na' ? (
                    <>
                      <Button size="small" icon={<FormOutlined />} onClick={() => { setDetailModalOpen(false); openTrainingModal(selectedItem) }}>
                        {selectedItem.has_training ? 'Edit Training' : 'Training'}
                      </Button>
                      {renderActionNaControls(selectedItem)}
                    </>
                  ) : (
                    renderActionNaControls(selectedItem)
                  )}
                </div>
              </>
            ) : detailsData ? (
              <>
                <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
                  <Descriptions.Item label="Reference">{detailsData.reference_no}</Descriptions.Item>
                  <Descriptions.Item label="Company">{detailsData.company_name}</Descriptions.Item>
                  <Descriptions.Item label="Message Owner">{detailsData.message_owner === 'yes' ? 'Yes' : 'No'}</Descriptions.Item>
                  <Descriptions.Item label="Response">{detailsData.response || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Contact">{detailsData.contact || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Total Completion %">{detailsData.total_percentage != null ? `${detailsData.total_percentage}%` : '-'}</Descriptions.Item>
                  <Descriptions.Item label="Current Stage">
                    <strong>{detailsData.current_stage}</strong>
                    {detailsData.pending_features && detailsData.pending_features.length > 0 && (
                      <div style={{ marginTop: 4, color: '#d4380d' }}>Pending: {detailsData.pending_features.join(', ')}</div>
                    )}
                  </Descriptions.Item>
                </Descriptions>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                  {filterNa !== 'only_na' && !(detailsData.company_excluded_by_na || detailsData.marked_na) ? (
                    <>
                      <Button size="small" icon={<FormOutlined />} onClick={() => { setDetailModalOpen(false); openTrainingModal(selectedItem) }}>
                        {selectedItem.has_training ? 'Edit Training' : 'Training'}
                      </Button>
                      {renderActionNaControls({
                        ...selectedItem,
                        company_id: detailsData.company_id ?? selectedItem.company_id,
                        marked_na: detailsData.marked_na ?? selectedItem.marked_na,
                        company_excluded_by_na: detailsData.company_excluded_by_na ?? selectedItem.company_excluded_by_na,
                      })}
                      {selectedItem.feature_count != null && selectedItem.feature_count > 0 && (
                        <Button size="small" icon={<FormOutlined />} onClick={() => { setDetailModalOpen(false); openFollowupModal(selectedItem) }}>
                          Followup
                        </Button>
                      )}
                    </>
                  ) : (
                    renderActionNaControls({
                      ...selectedItem,
                      company_id: detailsData.company_id ?? selectedItem.company_id,
                      marked_na: detailsData.marked_na ?? selectedItem.marked_na,
                      company_excluded_by_na: detailsData.company_excluded_by_na ?? selectedItem.company_excluded_by_na,
                    })
                  )}
                </div>
                {detailsData.features_with_followups && detailsData.features_with_followups.length > 0 && (
                  <Card size="small" title="Features & Followups">
                    {detailsData.features_with_followups.map((f: { ticket_feature_id: string; feature_name: string; status: string; followups: Array<Record<string, unknown>> }) => (
                      <div key={f.ticket_feature_id} style={{ marginBottom: 8 }}>
                        <strong>{f.feature_name}</strong> – {f.status}
                        {f.followups && f.followups.length > 0 && (
                          <ul style={{ marginTop: 4, paddingLeft: 16 }}>
                            {f.followups.map((fu: Record<string, unknown>, idx: number) => (
                              <li
                                key={typeof fu.id === 'string' ? fu.id : idx}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 12,
                                  flexWrap: 'wrap',
                                  marginBottom: 4,
                                }}
                              >
                                <span style={{ flex: 1, minWidth: 220 }}>
                                  {formatFollowupHistoryLine({
                                    previous_percentage: fu.previous_percentage as number | undefined,
                                    added_percentage: fu.added_percentage as number | undefined,
                                    total_percentage: fu.total_percentage as number | undefined,
                                    status: String(fu.status ?? ''),
                                    remarks: fu.remarks as string | undefined,
                                    created_at: fu.created_at as string | undefined,
                                  })}
                                </span>
                                {fu.can_revert && fu.status === 'completed' && typeof fu.id === 'string' && (
                                  <Popconfirm
                                    title="Revert this Completed followup?"
                                    description="Within 24 hours only. Feature returns to Pending and total % is recalculated."
                                    onConfirm={() => void revertFollowup(fu.id as string)}
                                    okText="Back"
                                    cancelText="Cancel"
                                  >
                                    <Button type="link" size="small" icon={<UndoOutlined />} loading={followupSubmitting} style={{ padding: 0, height: 'auto' }}>
                                      Back
                                    </Button>
                                  </Popconfirm>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </Card>
                )}
              </>
            ) : (
              <>
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="Reference">{selectedItem.reference_no}</Descriptions.Item>
                  <Descriptions.Item label="Company">{selectedItem.company_name}</Descriptions.Item>
                  <Descriptions.Item label="Total Completion %">{selectedItem.total_percentage != null ? `${selectedItem.total_percentage}%` : '-'}</Descriptions.Item>
                  <Descriptions.Item label="Status">{selectedItem.completion_status === 'completed' ? 'Completed' : 'Active'}</Descriptions.Item>
                </Descriptions>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
                  {filterNa !== 'only_na' ? (
                    <>
                      <Button size="small" icon={<FormOutlined />} onClick={() => { setDetailModalOpen(false); openTrainingModal(selectedItem) }}>
                        {selectedItem.has_training ? 'Edit Training' : 'Training'}
                      </Button>
                      {renderActionNaControls(selectedItem)}
                    </>
                  ) : (
                    renderActionNaControls(selectedItem)
                  )}
                </div>
              </>
            )}
          </>
        )}
      </Modal>
    </div>
  )
}
