import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import {
  Table,
  Input,
  Select,
  Space,
  Card,
  Typography,
  Tag,
  DatePicker,
  Button,
  Dropdown,
} from 'antd'
import { SearchOutlined, PhoneOutlined, MailOutlined, MessageOutlined, LinkOutlined, MoreOutlined } from '@ant-design/icons'
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom'
import { ticketsApi } from '../../api/tickets'
import { supportApi } from '../../api/support'
import { TicketDetailDrawer } from '../../components/tickets/TicketDetailDrawer'
import { ChoresBugsDetailDrawer } from '../../components/tickets/ChoresBugsDetailDrawer'
import { PrintExport } from '../../components/common/PrintExport'
import { TableLoadMoreSkeleton, TableWithSkeletonLoading } from '../../components/common/skeletons'
import { TextCellTooltip, tableCellEllipsisStyle } from '../../components/common/TextCellTooltip'
import {
  formatDateTable,
  formatDuration,
  formatReplySla,
  getChoresBugsCurrentStage,
  getFeatureCurrentStage,
  getTicketTimeDelayDisplay,
  TICKET_EXPORT_COLUMNS,
  buildTicketExportRow,
  truncateTitleDescCell,
  TICKET_TABLE_QA_PREVIEW_MAX_CHARS,
} from '../../utils/helpers'
import { useRole } from '../../hooks/useRole'
import type { Ticket } from '../../api/tickets'
import type { Company } from '../../api/support'
import { ROUTES } from '../../utils/constants'
import { sessionApiCacheClearLogicalPrefix } from '../../utils/sessionApiCache'
import { formatPriorityLabel, getPriorityTagColor, TICKET_PRIORITY_OPTIONS } from '../../utils/ticketPriority'

const { Title, Text } = Typography
const { Option } = Select
const { RangePicker } = DatePicker

const cardStyle = {
  borderRadius: 12,
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  border: 'none',
}

const getTypeColor = (type: string) => (type === 'chore' ? 'green' : type === 'bug' ? 'red' : 'blue')
const getPriorityColor = getPriorityTagColor
const getCommIcon = (v: string) => {
  if (v === 'phone') return <PhoneOutlined title="Phone" />
  if (v === 'mail') return <MailOutlined title="Mail" />
  if (v === 'whatsapp') return <MessageOutlined title="WhatsApp" />
  if (v === 'mom') return <MessageOutlined title="MOM" />
  return '-'
}

const truncate = (text: string | undefined, len = 40) => {
  if (!text) return '-'
  return text.length > len ? `${text.slice(0, len)}...` : text
}

function getRegisterStatusLabel(ticket: Ticket): 'Completed' | 'Rejected' | 'Other' {
  const status2 = String((ticket as { status_2?: string }).status_2 || '').toLowerCase()
  const live = String((ticket as { live_review_status?: string }).live_review_status || '').toLowerCase()
  const status = String(ticket.status || '').toLowerCase()
  if (status2 === 'rejected' || status === 'rejected') return 'Rejected'
  if (live === 'rejected') return 'Rejected'
  if (ticket.type === 'feature') {
    const f = getFeatureCurrentStage(ticket).stageLabel.toLowerCase()
    return f.includes('completed') ? 'Completed' : 'Other'
  }
  const s = String(getChoresBugsCurrentStage(ticket).status || '').toLowerCase()
  if (s === 'completed') return 'Completed'
  if (s === 'rejected') return 'Rejected'
  return 'Other'
}

/** Rows per scroll chunk (API uses page_size; server allows up to 200 per request). */
const TICKETS_CHUNK = 15

/** When API total is missing/0 but we received a full page, assume more rows exist. */
function resolveTicketListTotal(apiTotal: number, rowCount: number, pageSize: number): number {
  if (apiTotal > 0) return apiTotal
  if (rowCount < pageSize) return rowCount
  return rowCount + 1
}

/** Backend returns { data, total } — normalize nested axios envelopes. */
function unwrapTicketListPayload(
  response: unknown,
  pageSize = TICKETS_CHUNK,
): { rows: Ticket[]; total: number } {
  if (!response || typeof response !== 'object') return { rows: [], total: 0 }
  const r = response as Record<string, unknown>
  if (Array.isArray(r.data)) {
    const rows = r.data as Ticket[]
    const rawTotal = typeof r.total === 'number' ? r.total : 0
    return { rows, total: resolveTicketListTotal(rawTotal, rows.length, pageSize) }
  }
  if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) {
    const inner = r.data as Record<string, unknown>
    if (Array.isArray(inner.data)) {
      const rows = inner.data as Ticket[]
      const rawTotal = typeof inner.total === 'number' ? inner.total : 0
      return { rows, total: resolveTicketListTotal(rawTotal, rows.length, pageSize) }
    }
  }
  if (Array.isArray(r.items)) {
    const rows = r.items as Ticket[]
    const rawTotal = typeof r.total === 'number' ? r.total : 0
    return { rows, total: resolveTicketListTotal(rawTotal, rows.length, pageSize) }
  }
  return { rows: [], total: 0 }
}

export const TicketList = () => {
  const navigate = useNavigate()
  const { canAccessApproval, isUser, isMasterAdmin } = useRole()
  const [loading, setLoading] = useState(true)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [allTicketsForStageFilter, setAllTicketsForStageFilter] = useState<Ticket[]>([])
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const listFetchGeneration = useRef(0)
  const serverListPageRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const listExhaustedRef = useRef(false)
  const ticketsRef = useRef<Ticket[]>([])
  const totalRef = useRef(0)
  const scrollRootRef = useRef<HTMLDivElement>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)
  const [exportTickets, setExportTickets] = useState<Ticket[]>([])
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const typeFromUrl = searchParams.get('type') || new URLSearchParams(location.search).get('type') || ''
  const sectionFromUrl = searchParams.get('section') || new URLSearchParams(location.search).get('section') || ''
  const viewFromUrl = searchParams.get('view') === 'approval'
  const isApprovalSection = viewFromUrl || sectionFromUrl === 'approval-status'
  const isRegisterSection = sectionFromUrl === 'register-of-tickets'
  const showStageFilter = sectionFromUrl === 'chores-bugs'
  const showStageFilterForFeature = typeFromUrl === 'feature' && !isApprovalSection
  const isChoresBugsSection = sectionFromUrl === 'chores-bugs'

  useEffect(() => {
    if (isApprovalSection && !canAccessApproval) {
      navigate(ROUTES.DASHBOARD, { replace: true })
    }
  }, [isApprovalSection, canAccessApproval, navigate])
  const [searchInput, setSearchInput] = useState('')
  const [referenceFilterInput, setReferenceFilterInput] = useState('')
  const [companies, setCompanies] = useState<Company[]>([])
  const [drawerTicketId, setDrawerTicketId] = useState<string | null>(null)
  const [drawerTicketType, setDrawerTicketType] = useState<string | null>(null)
  const [filters, setFilters] = useState({
    search: '',
    reference_filter: '',
    status: '',
    type: typeFromUrl,
    types_in: sectionFromUrl === 'chores-bugs' ? 'chore,bug' : sectionFromUrl === 'completed-chores-bugs' ? 'chore,bug' : sectionFromUrl === 'rejected-tickets' ? 'chore,bug' : '',
    company_ids: [] as string[],
    priority: '',
    date_from: '',
    date_to: '',
    sort_by: 'created_at',
    sort_order: 'desc' as 'asc' | 'desc',
  })
  /** Stage filter: applies to table, Export and Print (filters current result set) */
  const [stageFilter, setStageFilter] = useState<string>('')
  /** Approval Status view: pending | unapproved (Unapprove) | rejected */
  const [approvalFilter, setApprovalFilter] = useState<string>('unapproved')
  /** Chores & Bugs only: filter by Stage 2 status (pending | completed | staging | hold) */
  const [status2Filter, setStatus2Filter] = useState<string>('')
  /** Register of Tickets: mandatory status filter */
  const [registerStatusFilter, setRegisterStatusFilter] = useState<'completed' | 'rejected' | 'all'>('completed')
  /** Chores & Bugs/Register: filter by Type of Request */
  const [typeOfRequestFilter, setTypeOfRequestFilter] = useState<string>('')
  const [registerTypeFilters, setRegisterTypeFilters] = useState<string[]>(['chore'])
  const isRegisterChoresBugsMode =
    isRegisterSection && registerTypeFilters.some((t) => t === 'chore' || t === 'bug')
  const isChoresBugs =
    sectionFromUrl === 'chores-bugs' ||
    sectionFromUrl === 'completed-chores-bugs' ||
    sectionFromUrl === 'rejected-tickets' ||
    sectionFromUrl === 'solutions' ||
    isRegisterChoresBugsMode

  /** Safety guard: Chores & Bugs sections must never show Feature rows. */
  const keepOnlyChoresAndBugs = (list: Ticket[]): Ticket[] =>
    list.filter((t) => t.type === 'chore' || t.type === 'bug')

  useEffect(() => {
    if (sectionFromUrl !== 'chores-bugs') setStatus2Filter('')
  }, [sectionFromUrl])
  useEffect(() => {
    if (sectionFromUrl !== 'chores-bugs' && sectionFromUrl !== 'register-of-tickets') {
      setTypeOfRequestFilter('')
      setRegisterTypeFilters(['chore'])
    }
  }, [sectionFromUrl])

  /** Open drawer when navigated from Support Dashboard (Reference click in Weekly Details, Pending Chores/Bugs, or Pending Feature) */
  useEffect(() => {
    const state = location.state as { openTicketId?: string; openTicketType?: string } | undefined
    const openId = state?.openTicketId
    const openType = state?.openTicketType
    if (!openId) return
    if (sectionFromUrl === 'chores-bugs' && (openType === 'chore' || openType === 'bug')) {
      setDrawerTicketId(openId)
      setDrawerTicketType(openType === 'bug' ? 'bug' : 'chore')
      navigate(location.pathname + location.search, { replace: true, state: {} })
    } else if (openType === 'feature') {
      setDrawerTicketId(openId)
      setDrawerTicketType('feature')
      navigate(location.pathname + location.search, { replace: true, state: {} })
    }
  }, [sectionFromUrl, location.state, location.pathname, location.search, navigate])

  useLayoutEffect(() => {
    const t = searchParams.get('type') || ''
    const s = searchParams.get('section') || ''
    const urlDateFrom = searchParams.get('date_from') || new URLSearchParams(location.search).get('date_from') || ''
    const urlDateTo = searchParams.get('date_to') || new URLSearchParams(location.search).get('date_to') || ''
    const viewApproval = searchParams.get('view') === 'approval' || s === 'approval-status'
    if (viewApproval) setApprovalFilter('unapproved')
    setFilters((f) => {
      const next = { ...f }
      if (viewApproval) {
        next.type = 'feature'
        next.types_in = ''
        next.status = ''
        next.date_from = ''
        next.date_to = ''
      } else if (s === 'chores-bugs') {
        next.type = ''
        next.types_in = 'chore,bug'
        next.status = '' // Chores & Bugs uses status_2_filter (Pending/Completed/Staging/Hold), not old status
        next.date_from = urlDateFrom || ''
        next.date_to = urlDateTo || ''
      } else if (s === 'completed-chores-bugs') {
        next.type = ''
        next.types_in = 'chore,bug'
        next.status = ''
        next.date_from = ''
        next.date_to = ''
      } else if (s === 'rejected-tickets') {
        next.type = ''
        next.types_in = 'chore,bug'
        next.status = ''
        next.date_from = ''
        next.date_to = ''
      } else if (s === 'completed-feature') {
        next.type = 'feature'
        next.types_in = ''
        next.status = ''
        next.date_from = ''
        next.date_to = ''
      } else if (s === 'register-of-tickets') {
        next.type = ''
        next.types_in = ''
        next.status = ''
        next.date_from = ''
        next.date_to = ''
        setRegisterTypeFilters((prev) => (prev.length ? prev : ['chore']))
        setRegisterStatusFilter('completed')
      } else if (s === 'solutions') {
        next.type = ''
        next.types_in = ''
        next.status = ''
        next.date_from = ''
        next.date_to = ''
      } else if (t) {
        next.type = t
        next.types_in = ''
        next.date_from = ''
        next.date_to = ''
      }
      return next
    })
  }, [searchParams, location.search])

  useEffect(() => {
    supportApi.getCompanies().then(setCompanies).catch(() => setCompanies([]))
  }, [])

  const getTicketsListParams = useCallback(
    (pageNum: number, limitSize: number, options?: { skipCache?: boolean }) => ({
      page: pageNum,
      page_size: limitSize,
      ...(options?.skipCache ? { skipCache: true } : {}),
      ...(filters.search && { search: filters.search, search_all_sections: true }),
      ...(filters.reference_filter && { reference_filter: filters.reference_filter }),
      ...(isChoresBugsSection && status2Filter && { status_2_filter: status2Filter }),
      ...(isChoresBugsSection && typeOfRequestFilter && { type_filter: typeOfRequestFilter }),
      ...(!isChoresBugsSection &&
        sectionFromUrl !== 'completed-chores-bugs' &&
        sectionFromUrl !== 'rejected-tickets' &&
        sectionFromUrl !== 'solutions' &&
        sectionFromUrl !== 'completed-feature' &&
        sectionFromUrl !== 'register-of-tickets' &&
        filters.status && { status: filters.status }),
      ...(sectionFromUrl !== 'chores-bugs' &&
        sectionFromUrl !== 'register-of-tickets' &&
        sectionFromUrl !== 'completed-chores-bugs' &&
        sectionFromUrl !== 'rejected-tickets' &&
        sectionFromUrl !== 'solutions' &&
        sectionFromUrl !== 'completed-feature' &&
        filters.types_in && { types_in: filters.types_in }),
      ...(sectionFromUrl !== 'chores-bugs' &&
        sectionFromUrl !== 'register-of-tickets' &&
        sectionFromUrl !== 'completed-chores-bugs' &&
        sectionFromUrl !== 'rejected-tickets' &&
        sectionFromUrl !== 'solutions' &&
        sectionFromUrl !== 'completed-feature' &&
        !filters.types_in &&
        filters.type && { type: filters.type }),
      ...(sectionFromUrl === 'chores-bugs' && { section: 'chores-bugs' }),
      ...(sectionFromUrl === 'register-of-tickets' && { section: 'register-of-tickets' }),
      ...(sectionFromUrl === 'completed-chores-bugs' && { section: 'completed-chores-bugs' }),
      ...(sectionFromUrl === 'rejected-tickets' && { section: 'rejected-tickets' }),
      ...(sectionFromUrl === 'completed-feature' && { section: 'completed-feature' }),
      ...(sectionFromUrl === 'solutions' && { section: 'solutions' }),
      ...(isRegisterSection && registerTypeFilters.length > 0 && { types_in: registerTypeFilters.join(',') }),
      ...(isApprovalSection && { section: 'approval-status', approval_filter: approvalFilter }),
      ...(filters.company_ids?.length ? { company_ids: filters.company_ids } : {}),
      ...(filters.priority && { priority: filters.priority }),
      ...(filters.date_from && { date_from: filters.date_from }),
      ...(filters.date_to && { date_to: filters.date_to }),
      sort_by: filters.sort_by,
      sort_order: filters.sort_order,
    }),
    [
      filters,
      isChoresBugsSection,
      sectionFromUrl,
      isApprovalSection,
      isRegisterSection,
      registerStatusFilter,
      registerTypeFilters,
      approvalFilter,
      status2Filter,
      typeOfRequestFilter,
    ],
  )

  /** Fetches all tickets across pages with current filters/section/view. Used for stage filter and export. */
  const fetchAllTicketsWithFilters = useCallback(async (): Promise<Ticket[]> => {
    const allTickets: Ticket[] = []
    let currentPage = 1
    const limit = 100
    let hasMore = true
    while (hasMore) {
      const response = await ticketsApi.list(getTicketsListParams(currentPage, limit, { skipCache: true }))
      const { rows: rawTickets, total: apiTotal } = unwrapTicketListPayload(response, limit)
      let pageTickets: Ticket[] = rawTickets
      if (isChoresBugs) {
        pageTickets = keepOnlyChoresAndBugs(pageTickets)
      }
      allTickets.push(...pageTickets)
      hasMore = rawTickets.length === limit && allTickets.length < apiTotal
      currentPage++
    }
    return allTickets
  }, [getTicketsListParams, isChoresBugs])

  const fetchAllTicketsForStageFilter = useCallback(async () => {
    const gen = ++listFetchGeneration.current
    setLoading(true)
    try {
      const allTickets = await fetchAllTicketsWithFilters()
      if (gen !== listFetchGeneration.current) return
      let list = stageFilter
        ? allTickets.filter((t) =>
            showStageFilter
              ? getChoresBugsCurrentStage(t).stageLabel === stageFilter
              : getFeatureCurrentStage(t).stageLabel === stageFilter
          )
        : allTickets
      if (typeFromUrl === 'feature' || sectionFromUrl === 'completed-feature') {
        list = [...list].sort((a, b) => {
          const refCompare = (b.reference_no || '').localeCompare(a.reference_no || '', undefined, { numeric: true })
          if (refCompare !== 0) return refCompare
          const tA = a.created_at ? new Date(a.created_at).getTime() : 0
          const tB = b.created_at ? new Date(b.created_at).getTime() : 0
          return tB - tA
        })
      }
      setAllTicketsForStageFilter(list)
      const initial = list.slice(0, TICKETS_CHUNK)
      setTickets(initial)
      setTotal(list.length)
      serverListPageRef.current = 0
    } catch (error) {
      console.error('Failed to fetch all tickets for stage filter:', error)
    } finally {
      if (gen === listFetchGeneration.current) setLoading(false)
    }
  }, [
    fetchAllTicketsWithFilters,
    stageFilter,
    showStageFilter,
    showStageFilterForFeature,
    typeFromUrl,
    sectionFromUrl,
  ])

  const fetchTicketsInitial = useCallback(async () => {
    const gen = ++listFetchGeneration.current
    listExhaustedRef.current = false
    setLoading(true)
    serverListPageRef.current = 0
    setTickets([])
    try {
      const response = await ticketsApi.list(getTicketsListParams(1, TICKETS_CHUNK, { skipCache: true }))
      if (gen !== listFetchGeneration.current) return
      const { rows, total: apiTotal } = unwrapTicketListPayload(response, TICKETS_CHUNK)
      let list = rows
      if (isChoresBugs) {
        list = keepOnlyChoresAndBugs(list)
      }
      setTickets(list)
      setTotal(apiTotal)
      serverListPageRef.current = 1
      listExhaustedRef.current =
        (apiTotal > 0 && list.length >= apiTotal) || list.length < TICKETS_CHUNK
    } catch (error) {
      console.error('Failed to fetch tickets:', error)
    } finally {
      if (gen === listFetchGeneration.current) setLoading(false)
    }
  }, [getTicketsListParams, isChoresBugs])

  const fetchTicketsAppend = useCallback(async () => {
    const gen = listFetchGeneration.current
    if (listExhaustedRef.current) return
    if (loadingMoreRef.current || serverListPageRef.current < 1) return
    if (totalRef.current > 0 && ticketsRef.current.length >= totalRef.current) return

    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const nextPage = serverListPageRef.current + 1
      const response = await ticketsApi.list(getTicketsListParams(nextPage, TICKETS_CHUNK, { skipCache: true }))
      if (gen !== listFetchGeneration.current) return
      const { rows, total: apiTotal } = unwrapTicketListPayload(response, TICKETS_CHUNK)
      let newRows = rows
      if (isChoresBugs) {
        newRows = keepOnlyChoresAndBugs(newRows)
      }
      if (typeof apiTotal === 'number' && apiTotal >= 0) {
        setTotal(apiTotal)
      }
      if (newRows.length === 0) {
        listExhaustedRef.current = true
        return
      }
      setTickets((prev) => {
        const merged = [...prev, ...newRows]
        if (typeof apiTotal === 'number' && merged.length >= apiTotal) {
          listExhaustedRef.current = true
        } else if (newRows.length < TICKETS_CHUNK) {
          listExhaustedRef.current = true
        }
        return merged
      })
      serverListPageRef.current = nextPage
    } catch (error) {
      console.error('Failed to load more tickets:', error)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [getTicketsListParams, isChoresBugs])

  const allTicketsForStageFilterRef = useRef<Ticket[]>([])
  useEffect(() => {
    allTicketsForStageFilterRef.current = allTicketsForStageFilter
  }, [allTicketsForStageFilter])

  useEffect(() => {
    ticketsRef.current = tickets
  }, [tickets])
  useEffect(() => {
    totalRef.current = total
  }, [total])

  const stageClientInfinite =
    (showStageFilter && !!stageFilter) || (showStageFilterForFeature && !!stageFilter)

  const tryLoadMoreTickets = useCallback(() => {
    if (loading) return
    if (loadingMoreRef.current) return
    if (stageClientInfinite) {
      const full = allTicketsForStageFilterRef.current
      if (ticketsRef.current.length >= full.length) return
      const next = Math.min(full.length, ticketsRef.current.length + TICKETS_CHUNK)
      setTickets(full.slice(0, next))
      return
    }
    void fetchTicketsAppend()
  }, [loading, stageClientInfinite, fetchTicketsAppend])

  useEffect(() => {
    sessionApiCacheClearLogicalPrefix('tickets:list:')
  }, [location.pathname, location.search])

  useEffect(() => {
    if ((showStageFilter && stageFilter) || (showStageFilterForFeature && stageFilter)) {
      void fetchAllTicketsForStageFilter()
    } else {
      if (allTicketsForStageFilter.length > 0) {
        setAllTicketsForStageFilter([])
      }
      void fetchTicketsInitial()
    }
  }, [
    fetchAllTicketsForStageFilter,
    fetchTicketsInitial,
    filters,
    isApprovalSection,
    approvalFilter,
    stageFilter,
    status2Filter,
    typeOfRequestFilter,
    registerTypeFilters,
    showStageFilter,
    showStageFilterForFeature,
    location.pathname,
    location.search,
  ])

  useEffect(() => {
    if (loading) return
    const tableBody = scrollRootRef.current?.querySelector('.ant-table-body') as HTMLElement | null
    const target = loadMoreSentinelRef.current
    if (!target) return
    const scrollRoot =
      tableBody && tableBody.contains(target) ? tableBody : null
    const rect = target.getBoundingClientRect()
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight
    if (rect.top <= viewportHeight + 160) {
      tryLoadMoreTickets()
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        tryLoadMoreTickets()
      },
      { root: scrollRoot, rootMargin: '160px', threshold: 0 },
    )
    io.observe(target)
    return () => io.disconnect()
  }, [loading, tryLoadMoreTickets, tickets.length, total, allTicketsForStageFilter.length, stageClientInfinite])

  const fetchAllForExport = async (): Promise<Ticket[]> => fetchAllTicketsWithFilters()

  const refetchList = useCallback(() => {
    if ((showStageFilter && stageFilter) || (showStageFilterForFeature && stageFilter)) {
      void fetchAllTicketsForStageFilter()
    } else {
      void fetchTicketsInitial()
    }
  }, [showStageFilter, showStageFilterForFeature, stageFilter, fetchAllTicketsForStageFilter, fetchTicketsInitial])

  const refetchListRef = useRef(refetchList)
  refetchListRef.current = refetchList
  useEffect(() => {
    const onTicketCreated = () => {
      void refetchListRef.current()
    }
    window.addEventListener('support-ticket-created', onTicketCreated)
    return () => window.removeEventListener('support-ticket-created', onTicketCreated)
  }, [])

  const handleSearch = () => {
    setFilters((f) => ({ ...f, search: searchInput }))
  }

  const handleReferenceFilterApply = () => {
    setFilters((f) => ({ ...f, reference_filter: referenceFilterInput }))
  }

  const handleDateRange = (_: unknown, dateStrings: [string, string]) => {
    const from = dateStrings[0] ? `${dateStrings[0]}T00:00:00.000Z` : ''
    const to = dateStrings[1] ? `${dateStrings[1]}T23:59:59.999Z` : ''
    setFilters((f) => ({ ...f, date_from: from, date_to: to }))
  }

  const showChoresBugsDrawer = isChoresBugs || drawerTicketType === 'chore' || drawerTicketType === 'bug'
  const isSolutionsSection = sectionFromUrl === 'solutions'

  /** When stage filter is set (Chores & Bugs or Feature), filter tickets for table, Export and Print */
  const baseListUnfiltered =
    showStageFilter && stageFilter
      ? tickets.filter((t) => getChoresBugsCurrentStage(t).stageLabel === stageFilter)
      : showStageFilterForFeature && stageFilter
        ? tickets.filter((t) => getFeatureCurrentStage(t).stageLabel === stageFilter)
        : tickets
  const baseList = isRegisterSection
    ? baseListUnfiltered.filter((t) => {
        const kindOk = registerTypeFilters.length === 0 || registerTypeFilters.includes(String(t.type || ''))
        if (!kindOk) return false
        if (registerStatusFilter === 'all') return true
        const s = getRegisterStatusLabel(t)
        return registerStatusFilter === 'completed' ? s === 'Completed' : s === 'Rejected'
      })
    : baseListUnfiltered

  /** Feature section: new tickets on top (FE-0091 above FE-0090), then by created_at desc */
  const ticketsForDisplay =
    typeFromUrl === 'feature' || sectionFromUrl === 'completed-feature'
      ? [...baseList].sort((a, b) => {
          const refCompare = (b.reference_no || '').localeCompare(a.reference_no || '', undefined, { numeric: true })
          if (refCompare !== 0) return refCompare
          const tA = a.created_at ? new Date(a.created_at).getTime() : 0
          const tB = b.created_at ? new Date(b.created_at).getTime() : 0
          return tB - tA
        })
      : baseList

  const getStageForExport = isChoresBugs
    ? (t: Record<string, unknown>) => getChoresBugsCurrentStage(t as Parameters<typeof getChoresBugsCurrentStage>[0])
    : typeFromUrl === 'feature'
      ? (t: Record<string, unknown>) => getFeatureCurrentStage(t as Parameters<typeof getFeatureCurrentStage>[0])
      : undefined

  const handleExportClick = async () => {
    const allTickets = await fetchAllForExport()
    let filteredForExport =
      showStageFilter && stageFilter
        ? allTickets.filter((t) => getChoresBugsCurrentStage(t).stageLabel === stageFilter)
        : showStageFilterForFeature && stageFilter
          ? allTickets.filter((t) => getFeatureCurrentStage(t).stageLabel === stageFilter)
          : allTickets
    if (typeFromUrl === 'feature' || sectionFromUrl === 'completed-feature') {
      filteredForExport = [...filteredForExport].sort((a, b) => {
        const refCompare = (b.reference_no || '').localeCompare(a.reference_no || '', undefined, { numeric: true })
        if (refCompare !== 0) return refCompare
        const tA = a.created_at ? new Date(a.created_at).getTime() : 0
        const tB = b.created_at ? new Date(b.created_at).getTime() : 0
        return tB - tA
      })
    }
    if (isRegisterSection) {
      filteredForExport = filteredForExport.filter((t) => {
        const kindOk = registerTypeFilters.length === 0 || registerTypeFilters.includes(String(t.type || ''))
        if (!kindOk) return false
        if (registerStatusFilter === 'all') return true
        const s = getRegisterStatusLabel(t)
        return registerStatusFilter === 'completed' ? s === 'Completed' : s === 'Rejected'
      })
    }
    setExportTickets(filteredForExport)
  }

  const wrapStyle = { whiteSpace: 'normal' as const, wordBreak: 'break-word' as const }

  const baseColumns = [
    {
      title: 'Reference No',
      dataIndex: 'reference_no',
      key: 'reference_no',
      width: 100,
      fixed: 'left' as const,
      render: (v: string) => v || '-',
    },
    ...(isMasterAdmin
      ? [
          {
            title: '',
            key: 'actions',
            width: 48,
            fixed: 'left' as const,
            render: (_: unknown, r: Ticket) => (
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'edit',
                      label: 'Edit',
                      onClick: () => {
                        setDrawerTicketId(r.id)
                        setDrawerTicketType(r.type ?? null)
                      },
                    },
                  ],
                }}
                trigger={['click']}
                getPopupContainer={() => document.body}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<MoreOutlined />}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Master Admin actions"
                />
              </Dropdown>
            ),
          },
        ]
      : []),
    {
      title: 'Company Name',
      dataIndex: 'company_name',
      key: 'company_name',
      width: 140,
      fixed: 'left' as const,
      ellipsis: false,
      render: (v: string) => <span style={wrapStyle}>{v?.trim() ? v : '-'}</span>,
    },
    {
      title: 'User Name',
      dataIndex: 'user_name',
      key: 'user_name',
      width: 100,
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: 'Page',
      dataIndex: 'page_name',
      key: 'page_name',
      width: 100,
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: 'Division',
      dataIndex: 'division_name',
      key: 'division_name',
      width: 100,
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: 'Other Division',
      dataIndex: 'division_other',
      key: 'division_other',
      width: 110,
      ellipsis: true,
      render: (_: unknown, r: Ticket) => (r.division_name === 'Other' ? (r.division_other || '-') : ''),
    },
    {
      title: 'Attachment',
      dataIndex: 'attachment_url',
      key: 'attachment_url',
      width: 100,
      render: (v: string) => {
        if (!v || !v.trim()) return '-'
        const url = v.trim()
        const isExternal = url.startsWith('http://') || url.startsWith('https://')
        const handleClick = (e: React.MouseEvent) => {
          e.preventDefault()
          e.stopPropagation()
          if (isExternal) {
            window.open(url, '_blank', 'noopener,noreferrer')
          }
        }
        return (
          <a
            href={isExternal ? url : '#'}
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noopener noreferrer' : undefined}
            onClick={handleClick}
            title="View attachment (opens in new tab)"
          >
            <LinkOutlined /> View
          </a>
        )
      },
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      width: 200,
      ellipsis: false,
      render: (v: string) => {
        const raw = (v && v.trim()) || ''
        if (!raw) return <span style={wrapStyle}>-</span>
        return (
          <TextCellTooltip tooltip={raw}>
            <span style={{ ...wrapStyle, ...tableCellEllipsisStyle }}>{raw}</span>
          </TextCellTooltip>
        )
      },
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      width: 220,
      ellipsis: false,
      render: (v: string) => {
        const raw = (v && v.trim()) || ''
        if (!raw) return <span style={wrapStyle}>-</span>
        return (
          <TextCellTooltip tooltip={raw}>
            <span style={{ ...wrapStyle, ...tableCellEllipsisStyle }}>{raw}</span>
          </TextCellTooltip>
        )
      },
    },
    {
      title: 'Type of Request',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (v: string) => <Tag color={getTypeColor(v)}>{v === 'chore' ? 'Chores' : v === 'bug' ? 'Bug' : 'Feature'}</Tag>,
    },
    {
      title: 'CT',
      dataIndex: 'communicated_through',
      key: 'communicated_through',
      width: 70,
      render: (v: string) => getCommIcon(v),
    },
    {
      title: 'Submitted By',
      dataIndex: 'submitted_by',
      key: 'submitted_by',
      width: 110,
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: 'Query Arrival',
      dataIndex: 'query_arrival_at',
      key: 'query_arrival_at',
      width: 140,
      render: (v: string) => formatDateTable(v),
    },
    {
      title: 'Quality of Response',
      dataIndex: 'quality_of_response',
      key: 'quality_of_response',
      width: 140,
      ellipsis: false,
      render: (v: string) => (
        <span style={wrapStyle} title={v?.trim() ? String(v) : undefined}>
          {truncateTitleDescCell(v || undefined, TICKET_TABLE_QA_PREVIEW_MAX_CHARS)}
        </span>
      ),
    },
    {
      title: 'Customer Questions',
      dataIndex: 'customer_questions',
      key: 'customer_questions',
      width: 140,
      ellipsis: false,
      render: (v: string) => (
        <span style={wrapStyle} title={v?.trim() ? String(v) : undefined}>
          {truncateTitleDescCell(v || undefined, TICKET_TABLE_QA_PREVIEW_MAX_CHARS)}
        </span>
      ),
    },
    {
      title: 'Query Response',
      dataIndex: 'query_response_at',
      key: 'query_response_at',
      width: 140,
      render: (v: string) => formatDateTable(v),
    },
    ...(isChoresBugs
      ? [
          {
            title: 'Reply Status',
            key: 'reply_status',
            width: 180,
            ellipsis: false,
            render: (_: unknown, r: Ticket) => {
              const sla = formatReplySla(r.query_arrival_at, r.query_response_at)
              return (
                <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
                  <Tag color={sla.status === 'on-time' ? 'green' : 'red'}>{sla.text}</Tag>
                </span>
              )
            },
          },
          {
            title: 'Priority',
            dataIndex: 'priority',
            key: 'priority',
            width: 90,
            render: (_: unknown, r: Ticket) => (
              <Tag color={getPriorityColor(r.priority)}>{formatPriorityLabel(r.priority)}</Tag>
            ),
          },
        ]
      : []),
    ...(!isChoresBugs
      ? [
          {
            title: 'Current Stage',
            key: 'current_stage_feature',
            width: 140,
            ellipsis: false,
            render: (_: unknown, r: Ticket) =>
              r.type === 'feature' ? (
                <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{getFeatureCurrentStage(r).stageLabel}</span>
              ) : (
                '-'
              ),
          },
          {
            title: 'Priority',
            dataIndex: 'priority',
            key: 'priority',
            width: 90,
            render: (_: unknown, r: Ticket) =>
              r.type === 'feature' ? (
                <Tag color={getPriorityColor(r.priority)}>{formatPriorityLabel(r.priority)}</Tag>
              ) : (
                '-'
              ),
          },
          {
            title: 'Why Feature?',
            dataIndex: 'why_feature',
            key: 'why_feature',
            width: 100,
            ellipsis: true,
            render: (_: unknown, r: Ticket) => (r.type === 'feature' ? truncate(r.why_feature, 20) : ''),
          },
        ]
      : []),
    ...(viewFromUrl
      ? [
          {
            title: 'Approval Status',
            key: 'approval_status',
            width: 120,
            render: (_: unknown, r: Ticket) => {
              const s = r.approval_status ?? 'Pending'
              const label =
                s === 'approved' ? 'Approved' : s === 'rejected' ? 'Rejected' : s === 'unapproved' ? 'Unapprove' : 'Pending'
              const color =
                s === 'approved' ? 'green' : s === 'rejected' ? 'red' : s === 'unapproved' ? 'orange' : 'default'
              return <Tag color={color}>{label}</Tag>
            },
          },
          {
            title: 'Approved By',
            dataIndex: 'approved_by_name',
            key: 'approved_by_name',
            width: 120,
            render: (v: string) => v || '-',
          },
          {
            title: 'Approved At',
            dataIndex: 'approval_actual_at',
            key: 'approval_actual_at',
            width: 140,
            render: (_: unknown, r: Ticket) =>
              formatDateTable(r.approval_actual_at || r.unapproval_actual_at) || '-',
          },
          {
            title: 'Source',
            dataIndex: 'approval_source',
            key: 'approval_source',
            width: 80,
            render: (v: string) => (v ? v.toUpperCase() : '-'),
          },
        ]
      : []),
  ]

  const choresBugsSlaColumns = sectionFromUrl === 'chores-bugs' || isRegisterSection
    ? [
        {
          title: 'Current Stage',
          key: 'current_stage',
          width: 100,
          ellipsis: false,
          render: (_: unknown, r: Ticket) => {
            const stage = getChoresBugsCurrentStage(r)
            return <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{stage.stageLabel}</span>
          },
        },
        {
          title: 'Planned',
          key: 'planned',
          width: 120,
          ellipsis: false,
          render: (_: unknown, r: Ticket) => {
            const stage = getChoresBugsCurrentStage(r)
            return <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{stage.planned}</span>
          },
        },
        {
          title: 'Actual',
          key: 'actual',
          width: 120,
          ellipsis: false,
          render: (_: unknown, r: Ticket) => {
            const stage = getChoresBugsCurrentStage(r)
            return <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{stage.actual}</span>
          },
        },
        {
          title: 'Status',
          key: 'sla_status',
          width: 100,
          ellipsis: false,
          render: (_: unknown, r: Ticket) => {
            const stage = getChoresBugsCurrentStage(r)
            const displayStatus = isRegisterSection ? getRegisterStatusLabel(r) : stage.status || '-'
            const status = String(displayStatus).toLowerCase()
            const statusColors: Record<string, string> = {
              pending: 'orange',
              completed: 'green',
              staging: 'blue',
              hold: 'default',
              na: 'default',
              rejected: 'red',
            }
            const color = statusColors[status] ?? 'default'
            return (
              <Tag color={color} style={{ margin: 0 }}>
                {displayStatus}
              </Tag>
            )
          },
        },
        {
          title: 'Time Delay',
          key: 'time_delay',
          width: 100,
          ellipsis: false,
          render: (_: unknown, r: Ticket) => {
            const display = getTicketTimeDelayDisplay(r)
            return <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{display}</span>
          },
        },
      ]
    : []

  const completedChoresBugsQualityColumn = sectionFromUrl === 'completed-chores-bugs'
    ? [
        {
          title: 'Quality of Solution',
          dataIndex: 'quality_solution',
          key: 'quality_solution',
          width: 180,
          ellipsis: false,
          render: (v: string) => (
            <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{v || '-'}</span>
          ),
        },
      ]
    : []

  const solutionColumns = [
    {
      title: 'Reference No',
      dataIndex: 'reference_no',
      key: 'reference_no',
      width: 110,
      render: (v: string) => v || '-',
    },
    {
      title: 'Company Name',
      dataIndex: 'company_name',
      key: 'company_name',
      width: 160,
      ellipsis: false,
      render: (v: string) => <span style={wrapStyle}>{v?.trim() ? v : '-'}</span>,
    },
    {
      title: 'Quality of Solution',
      dataIndex: 'quality_solution',
      key: 'quality_solution',
      width: 200,
      ellipsis: true,
      render: (v: string) => truncate(v, 60),
    },
    {
      title: 'Submitted By',
      dataIndex: 'quality_solution_submitted_by',
      key: 'quality_solution_submitted_by',
      width: 130,
      ellipsis: true,
      render: (v: string) => v || '-',
    },
  ]

  const columns = isSolutionsSection ? solutionColumns : [
    ...baseColumns,
    ...choresBugsSlaColumns,
    ...completedChoresBugsQualityColumn,
    ...(!isChoresBugs
      ? [
          {
            title: 'Approval Status',
            dataIndex: 'approval_status',
            key: 'approval_status',
            width: 110,
            render: (_: unknown, r: Ticket) =>
              r.type === 'feature' ? (
                <Tag color={r.approval_status === 'approved' ? 'green' : 'default'}>
                  {r.approval_status === 'approved' ? 'Approved' : 'Unapproved'}
                </Tag>
              ) : (
                '-'
              ),
          },
          {
            title: 'Actual Time',
            dataIndex: 'actual_time_seconds',
            key: 'actual_time_seconds',
            width: 100,
            render: (_: unknown, r: Ticket) => (r.type === 'feature' ? formatDuration(r.actual_time_seconds) : '-'),
          },
          {
            title: 'Remarks',
            dataIndex: 'remarks',
            key: 'remarks',
            width: 100,
            ellipsis: true,
            render: (_: unknown, r: Ticket) => (r.type === 'feature' ? truncate(r.remarks, 20) : '-'),
          },
          {
            title: 'Time Delay',
            key: 'time_delay',
            width: 100,
            ellipsis: false,
            render: (_: unknown, r: Ticket) =>
              r.type === 'feature' ? (
                <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{getTicketTimeDelayDisplay(r)}</span>
              ) : (
                '-'
              ),
          },
        ]
      : []),
  ]

  const pageTitle =
    isApprovalSection
      ? 'Approval Status'
      : sectionFromUrl === 'chores-bugs'
        ? 'Chores & Bugs'
        : sectionFromUrl === 'completed-chores-bugs'
          ? 'Completed Chores & Bugs'
          : sectionFromUrl === 'rejected-tickets'
            ? 'Rejected Tickets'
            : sectionFromUrl === 'completed-feature'
              ? 'Completed Feature'
              : sectionFromUrl === 'register-of-tickets'
                ? 'Register of Tickets'
              : sectionFromUrl === 'solutions'
                ? 'Solution'
                : typeFromUrl === 'feature'
                  ? 'Feature'
                  : 'All Tickets'

  const isCompletedChoresBugs = sectionFromUrl === 'completed-chores-bugs'

  const exportColumns = [...TICKET_EXPORT_COLUMNS]
  const exportRows = (exportTickets.length > 0 ? exportTickets : ticketsForDisplay).map((t) => buildTicketExportRow(t as unknown as Record<string, unknown>, getStageForExport))

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto' }}>
      {isCompletedChoresBugs && (
        <style>{`.completed-chores-bugs-wrap .ant-table-cell,
.completed-chores-bugs-wrap .ant-table-thead > tr > th { white-space: normal !important; word-break: break-word !important; }`}</style>
      )}
      <Space className="page-toolbar-row" style={{ marginBottom: 16, width: '100%', flexWrap: 'wrap' }}>
        <Title
          level={2}
          className="page-main-heading"
          style={{
            margin: 0,
            ...(isCompletedChoresBugs ? { whiteSpace: 'normal' as const, wordBreak: 'break-word' as const } : {}),
          }}
        >
          {pageTitle}
        </Title>
        <PrintExport pageTitle={pageTitle} exportData={{ columns: exportColumns, rows: exportRows }} exportFilename={`tickets_${sectionFromUrl || 'all'}`} onExportClick={handleExportClick} />
      </Space>

      <Card style={cardStyle} bodyStyle={{ padding: 24 }}>
        <Space style={{ marginBottom: 16, width: '100%' }} wrap>
          <Input
            placeholder="Global search..."
            prefix={<SearchOutlined />}
            style={{ width: 220 }}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onPressEnter={handleSearch}
            allowClear
          />
          <Button type="primary" onClick={handleSearch}>
            Search
          </Button>
          <Input
            placeholder="Reference Filter"
            style={{ width: 160 }}
            value={referenceFilterInput}
            onChange={(e) => setReferenceFilterInput(e.target.value)}
            onPressEnter={handleReferenceFilterApply}
            allowClear
          />
          {isApprovalSection && (
            <Select
              placeholder="Approval"
              style={{ width: 160 }}
              value={approvalFilter}
              onChange={(v) => {
                setApprovalFilter(v ?? 'unapproved')
              }}
              getPopupContainer={() => document.body}
              options={[
                { value: 'unapproved', label: 'Unapprove' },
                { value: 'rejected', label: 'Rejected' },
                { value: 'pending', label: 'Pending approval' },
              ]}
            />
          )}
          <Select
            mode="multiple"
            placeholder="Company"
            style={{ width: 220 }}
            value={filters.company_ids?.length ? filters.company_ids : undefined}
            onChange={(v) => {
              setFilters((f) => ({ ...f, company_ids: Array.isArray(v) ? v : [] }))
            }}
            allowClear
            showSearch
            optionFilterProp="label"
            filterOption={(input, opt) => (opt?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
            getPopupContainer={() => document.body}
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
          />
          {isChoresBugsSection || isRegisterSection ? (
            <Select
              placeholder="Status"
              style={{ width: 130 }}
              value={isRegisterSection ? registerStatusFilter : status2Filter || undefined}
              onChange={(v) => {
                if (isRegisterSection) {
                  setRegisterStatusFilter((v || 'completed') as 'completed' | 'rejected' | 'all')
                } else {
                  setStatus2Filter(v ?? '')
                }
              }}
              allowClear={!isRegisterSection}
              getPopupContainer={() => document.body}
            >
              {isRegisterSection ? (
                <>
                  <Option value="completed">Completed</Option>
                  <Option value="rejected">Rejected</Option>
                  <Option value="all">All</Option>
                </>
              ) : (
                <>
                  <Option value="pending">Pending</Option>
                  <Option value="completed">Completed</Option>
                  <Option value="staging">Staging</Option>
                  <Option value="hold">Hold</Option>
                  <Option value="na">NA</Option>
                  <Option value="rejected">Rejected</Option>
                </>
              )}
            </Select>
          ) : (
            <Select
              placeholder="Status"
              style={{ width: 130 }}
              value={filters.status || undefined}
              onChange={(v) => setFilters((f) => ({ ...f, status: v || '' }))}
              allowClear
              getPopupContainer={() => document.body}
            >
              <Option value="open">Open</Option>
              <Option value="in_progress">In Progress</Option>
              <Option value="resolved">Resolved</Option>
              <Option value="closed">Closed</Option>
              <Option value="cancelled">Cancelled</Option>
              <Option value="on_hold">On Hold</Option>
            </Select>
          )}
          {isChoresBugsSection || isRegisterSection ? (
            <Select
              mode={isRegisterSection ? 'multiple' : undefined}
              placeholder="Type of Request"
              style={{ width: isRegisterSection ? 240 : 150 }}
              value={isRegisterSection ? registerTypeFilters : typeOfRequestFilter || undefined}
              onChange={(v) => {
                if (isRegisterSection) {
                  const next = (Array.isArray(v) ? v : []).filter(Boolean)
                  setRegisterTypeFilters(next.length ? next : ['chore'])
                } else {
                  setTypeOfRequestFilter((v as string) ?? '')
                }
              }}
              allowClear={!isRegisterSection}
              getPopupContainer={() => document.body}
            >
              <Option value="chore">Chores</Option>
              <Option value="bug">Bug</Option>
              {isRegisterSection && <Option value="feature">Feature</Option>}
            </Select>
          ) : null}
          {isChoresBugsSection || !isRegisterSection ? (
            <Select
              placeholder="Priority"
              style={{ width: 110 }}
              value={filters.priority || undefined}
              onChange={(v) => setFilters((f) => ({ ...f, priority: v || '' }))}
              allowClear
              getPopupContainer={() => document.body}
            >
              {TICKET_PRIORITY_OPTIONS.map((o) => (
                <Option key={o.value} value={o.value}>
                  {o.label}
                </Option>
              ))}
            </Select>
          ) : null}
          {showStageFilter && (
            <Select
              placeholder="Stage"
              style={{ width: 140 }}
              value={stageFilter || undefined}
              onChange={(v) => {
                setStageFilter(v ?? '')
              }}
              allowClear
              aria-label="Filter by stage"
              getPopupContainer={() => document.body}
            >
              <Option value="Stage 1">Stage 1</Option>
              <Option value="Stage 2">Stage 2</Option>
              <Option value="Stage 3">Stage 3</Option>
              <Option value="Stage 4">Stage 4</Option>
            </Select>
          )}
          {showStageFilterForFeature && (
            <Select
              placeholder="Stage"
              style={{ width: 140 }}
              value={stageFilter || undefined}
              onChange={(v) => {
                setStageFilter(v ?? '')
              }}
              allowClear
              aria-label="Filter by stage"
              getPopupContainer={() => document.body}
            >
              <Option value="Stage 1">Stage 1</Option>
              <Option value="Stage 2">Stage 2</Option>
              <Option value="Completed">Completed</Option>
            </Select>
          )}
          <RangePicker
            placeholder={['From', 'To']}
            onChange={handleDateRange}
            style={{ width: 240 }}
          />
        </Space>

        <TableWithSkeletonLoading loading={loading} columns={12} rows={14}>
          <div ref={scrollRootRef}>
            <Table
              className={isCompletedChoresBugs ? 'completed-chores-bugs-wrap' : undefined}
              columns={columns}
              dataSource={ticketsForDisplay}
              rowKey="id"
              virtual={!isChoresBugsSection}
              loading={false}
              locale={{
                emptyText:
                  sectionFromUrl === 'chores-bugs'
                    ? 'No pending chores or bugs (Stages 1–4) without a submitted Solution form.'
                    : 'No tickets yet.',
              }}
              scroll={{ x: 2400, y: 600 }}
              pagination={false}
              summary={() => (
                <Table.Summary>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={columns.length}>
                      <div
                        ref={loadMoreSentinelRef}
                        style={{ height: 8, minHeight: 8 }}
                        aria-hidden
                      />
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          paddingBottom: 4,
                        }}
                      >
                        <Text type="secondary">
                          Showing {ticketsForDisplay.length} of{' '}
                          {stageClientInfinite ? allTicketsForStageFilter.length : total} tickets
                          {ticketsForDisplay.length <
                          (stageClientInfinite ? allTicketsForStageFilter.length : total)
                            ? ' · scroll to load more'
                            : ''}
                        </Text>
                        {loadingMore ? <TableLoadMoreSkeleton rows={2} columns={6} /> : null}
                      </div>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
              onChange={(_, __, sorter) => {
                const s = Array.isArray(sorter) ? sorter[0] : sorter
                if (s && 'field' in s && s.field) {
                  setFilters((f) => ({
                    ...f,
                    sort_by: String(s.field),
                    sort_order: s.order === 'ascend' ? 'asc' : 'desc',
                  }))
                }
              }}
              onRow={(record) => ({
                onClick: () => {
                  setDrawerTicketId(record.id)
                  setDrawerTicketType((record as { type?: string }).type ?? null)
                },
                style: { cursor: 'pointer' },
              })}
              size="small"
            />
          </div>
        </TableWithSkeletonLoading>
      </Card>

      {showChoresBugsDrawer ? (
        <ChoresBugsDetailDrawer
          ticketId={drawerTicketId}
          open={!!drawerTicketId}
          onClose={() => {
            setDrawerTicketId(null)
            setDrawerTicketType(null)
            refetchList()
          }}
          onUpdate={refetchList}
          readOnly={
            sectionFromUrl === 'completed-chores-bugs' ||
            sectionFromUrl === 'solutions' ||
            sectionFromUrl === 'register-of-tickets'
          }
        />
      ) : (
        <TicketDetailDrawer
          ticketId={drawerTicketId}
          open={!!drawerTicketId}
          onClose={() => {
            setDrawerTicketId(null)
            setDrawerTicketType(null)
            refetchList()
          }}
          onUpdate={refetchList}
          readOnly={
            sectionFromUrl === 'completed-feature' ||
            sectionFromUrl === 'register-of-tickets' ||
            (isApprovalSection && isUser && !isMasterAdmin)
          }
          approvalMode={isApprovalSection}
        />
      )}
    </div>
  )
}
