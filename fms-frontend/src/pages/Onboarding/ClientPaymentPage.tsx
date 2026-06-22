import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { Button, Card, Checkbox, DatePicker, Descriptions, Divider, Drawer, Form, Input, InputNumber, Modal, Select, Space, Table, Tooltip, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CheckCircleOutlined, EditOutlined, FormOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { API_ENDPOINTS } from '../../utils/constants'
import { apiClient } from '../../api/axios'
import { useAuth } from '../../hooks/useAuth'
import { TableWithSkeletonLoading } from '../../components/common/skeletons'
import { DEFAULT_INFINITE_CHUNK, useInfiniteScrollChunk } from '../../hooks/useInfiniteScrollChunk'
import { exportRowsToCsv, type ExportColumn } from '../../utils/exportCsv'
import { PaymentAmountKpiCards } from '../../components/onboarding/PaymentAmountKpiCards'
import { invalidateAfterDashboardPaymentSubmit } from '../../utils/sessionApiCache'
import { OperationsSectionTabs } from '../../components/common/OperationsSectionTabs'

const { Title, Text } = Typography

/** Edit submitted Client Payment responses within this many days of submit (must match backend). */
const CLIENT_PAYMENT_EDIT_DAYS = 150

/** Clears cached dashboard metrics and signals Dashboard (same tab) to refetch live totals (due / received). */
function invalidateDashboardPaymentMetrics() {
  invalidateAfterDashboardPaymentSubmit()
  window.dispatchEvent(new CustomEvent('client-payment-na-changed'))
}

interface ClientPaymentRecord {
  id: string
  timestamp: string
  reference_no?: string
  company_name: string
  invoice_date: string | null
  invoice_amount: string | null
  invoice_number: string | null
  genre: 'M' | 'Q' | 'HY' | 'Y'
  stage?: string | null
  status?: string
  aging_days?: number
  payment_received_date?: string | null
  /** From list API: Invoice Sent form has been saved (Payment Received form can be submitted). */
  invoice_sent_submitted?: boolean
  marked_na?: boolean
}

const GENRE_OPTIONS = [
  { label: "M – Monthly", value: 'M' },
  { label: "Q – Quarterly", value: 'Q' },
  { label: "HY – Half yearly", value: 'HY' },
  { label: "Y – Yearly", value: 'Y' },
]

const COMP_REGISTER_SECTION = 'Comp-Register'
const COMPLETED_REGISTER_PAGE_SIZE = 10
const OPEN_LIST_PAGE_SIZE = 50

export function ClientPaymentPage() {
  const { user } = useAuth()
  const [records, setRecords] = useState<ClientPaymentRecord[]>([])
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  /** Loaded lazily when "Add Raised Invoice" opens — avoids blocking the table on /companies. */
  const [companiesLoading, setCompaniesLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<ClientPaymentRecord | null>(null)
  const [sentModalOpen, setSentModalOpen] = useState(false)
  const [sentLoading, setSentLoading] = useState(false)
  const [sentEditable, setSentEditable] = useState(true)
  const [sentSummary, setSentSummary] = useState<{
    email_sent?: boolean
    courier_sent?: boolean
    whatsapp_sent?: boolean
  } | null>(null)
  const [sentDetails, setSentDetails] = useState<{
    email?: string | null
    tracking_details?: string | null
    whatsapp_number?: string | null
  } | null>(null)
  const [sentSubmitted, setSentSubmitted] = useState(false)
  const [sentForm] = Form.useForm()
  /** Follow up fields shown inside Invoice Sent modal (next slot only). */
  const [sentInlineFollowupForm] = Form.useForm()
  const [form] = Form.useForm()
  const [editInvoiceModalOpen, setEditInvoiceModalOpen] = useState(false)
  const [editInvoiceSubmitLoading, setEditInvoiceSubmitLoading] = useState(false)
  const [editInvoiceForm] = Form.useForm()

  const [followupModalOpen, setFollowupModalOpen] = useState(false)
  const [followupLoading, setFollowupLoading] = useState(false)
  const [followupEditable, setFollowupEditable] = useState(true)
  const [, setFollowupSubmitted] = useState(false)
  const [, setFollowupSummary] = useState<{
    contact_person?: string | null
    mail_sent?: boolean
    whatsapp_sent?: boolean
  } | null>(null)
  const [, setFollowupDetails] = useState<{
    remarks?: string | null
  } | null>(null)
  const [followupForm] = Form.useForm()
  const [drawerStatusLoading, setDrawerStatusLoading] = useState(false)
  const [nextFollowupNo, setNextFollowupNo] = useState(1)
  const [followupsItems, setFollowupsItems] = useState<
    {
      followup_no: number
      contact_person?: string | null
      remarks?: string | null
      mail_sent?: boolean
      whatsapp_sent?: boolean
      followup_timestamp?: string | null
      created_at?: string
      editable_24h?: boolean
    }[]
  >([])
  const [interceptSubmitted, setInterceptSubmitted] = useState(false)
  const [interceptDetails, setInterceptDetails] = useState<{
    last_remark_user?: string | null
    usage_last_1_month?: string | null
    contact_person?: string | null
    contact_number?: string | null
    tagged_user_id?: string | null
    tagged_user_name?: string | null
    tagged_user_email?: string | null
    tagged_user_2_id?: string | null
    tagged_user_2_name?: string | null
    tagged_user_2_email?: string | null
    payment_action_person?: string | null
    payment_action_remarks?: string | null
    payment_action_submitted_at?: string | null
    payment_action_2_person?: string | null
    payment_action_2_remarks?: string | null
    payment_action_2_submitted_at?: string | null
  } | null>(null)
  const [interceptEditable, setInterceptEditable] = useState(true)
  const [interceptModalOpen, setInterceptModalOpen] = useState(false)
  const [interceptForm] = Form.useForm()
  const [discontinuationSubmitted, setDiscontinuationSubmitted] = useState(false)
  const [discontinuationDetails, setDiscontinuationDetails] = useState<{
    mail_sent_to?: string | null
    mail_sent_on?: string | null
    remarks?: string | null
  } | null>(null)
  const [discontinuationModalOpen, setDiscontinuationModalOpen] = useState(false)
  const [discontinuationForm] = Form.useForm()
  const [interceptTagModalOpen, setInterceptTagModalOpen] = useState(false)
  const [interceptTag2ModalOpen, setInterceptTag2ModalOpen] = useState(false)
  const [tagUsers, setTagUsers] = useState<{ id: string; full_name: string; email: string }[]>([])
  const [tagLoading, setTagLoading] = useState(false)
  const [tagSelectedUserId, setTagSelectedUserId] = useState<string | null>(null)
  const [tag2SelectedUserId, setTag2SelectedUserId] = useState<string | null>(null)
  const [paymRecModalOpen, setPaymRecModalOpen] = useState(false)
  const [paymRecForm] = Form.useForm()
  const [paymentReceiveSubmitted, setPaymentReceiveSubmitted] = useState(false)
  const [paymentReceiveDetails, setPaymentReceiveDetails] = useState<{
    party_name?: string | null
    invoice_number?: string | null
    amount?: number | string | null
    payment_date?: string | null
  } | null>(null)
  const [paymentReceiveCreatedAt, setPaymentReceiveCreatedAt] = useState<string | null>(null)
  const [currentFollowupNo, setCurrentFollowupNo] = useState(1)
  const [companyNameFilter, setCompanyNameFilter] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [selectedExportColumns, setSelectedExportColumns] = useState<string[]>([])
  /** Open list only: show rows where Invoice Sent is saved but payment is not yet received. */
  const [awaitingPaymentReceiveOnly, setAwaitingPaymentReceiveOnly] = useState(false)
  /** active = default list (hide NA); na = only NA-marked invoices */
  const [naListView, setNaListView] = useState<'active' | 'na'>('active')
  const [markedNaSupported, setMarkedNaSupported] = useState(false)
  const [kpiRefreshKey, setKpiRefreshKey] = useState(0)
  const [markingNa, setMarkingNa] = useState(false)
  /** Comp _ Register: total completed rows (server) for infinite scroll. */
  const [completedRegisterTotal, setCompletedRegisterTotal] = useState(0)
  const [loadingMoreCompleted, setLoadingMoreCompleted] = useState(false)
  const [openListTotal, setOpenListTotal] = useState(0)
  const [loadingMoreOpen, setLoadingMoreOpen] = useState(false)

  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const compRegisterNextPageRef = useRef(1)
  const openListNextPageRef = useRef(1)
  const completedSection = location.pathname.includes('/completed/')
    ? location.pathname.split('/completed/')[1]?.split('/')[0] || null
    : null
  const isCompRegister = completedSection === COMP_REGISTER_SECTION
  const compRegisterGenre = useMemo(() => {
    const raw = (searchParams.get('genre') || '').trim().toUpperCase()
    if (raw === 'M' || raw === 'Q' || raw === 'HY' || raw === 'Y') return raw as 'M' | 'Q' | 'HY' | 'Y'
    return ''
  }, [searchParams])
  const isOpenList = !completedSection

  const listBasePath = API_ENDPOINTS.CLIENT_PAYMENT.LIST.split('?')[0] || '/onboarding/client-payment'

  const loadOpenListAllPages = useCallback(async () => {
    setLoading(true)
    setCompletedRegisterTotal(0)
    setOpenListTotal(0)
    openListNextPageRef.current = 2
    try {
      const r = await apiClient.get<{
        items?: ClientPaymentRecord[]
        data?: ClientPaymentRecord[]
        total?: number
        marked_na_supported?: boolean
      }>(listBasePath, { params: { status: 'open', page_size: OPEN_LIST_PAGE_SIZE, page: 1, na_view: naListView } })
      const body = r.data
      if (typeof body?.marked_na_supported === 'boolean') {
        setMarkedNaSupported(body.marked_na_supported)
      }
      const chunk = Array.isArray(body?.data) ? body.data : Array.isArray(body?.items) ? body.items : []
      setRecords(chunk as ClientPaymentRecord[])
      setOpenListTotal(typeof body?.total === 'number' ? body.total : chunk.length)
    } catch (e: unknown) {
      setRecords([])
      const err = e as { response?: { data?: { detail?: string } } }
      message.warning(err?.response?.data?.detail || 'Could not load invoice list. Check backend connection.')
    } finally {
      setLoading(false)
    }
  }, [listBasePath, naListView])

  const loadMoreOpenListPage = useCallback(async () => {
    if (!isOpenList) return
    if (loading || loadingMoreOpen) return
    if (openListTotal > 0 && records.length >= openListTotal) return
    const nextPage = openListNextPageRef.current
    if (nextPage < 2) return
    setLoadingMoreOpen(true)
    try {
      const r = await apiClient.get<{
        items?: ClientPaymentRecord[]
        data?: ClientPaymentRecord[]
        total?: number
      }>(listBasePath, {
        params: { status: 'open', page_size: OPEN_LIST_PAGE_SIZE, page: nextPage, na_view: naListView },
      })
      const body = r.data
      const chunk = Array.isArray(body?.data) ? body.data : Array.isArray(body?.items) ? body.items : []
      if (typeof body?.total === 'number') setOpenListTotal(body.total)
      if (chunk.length > 0) {
        setRecords((prev) => [...prev, ...(chunk as ClientPaymentRecord[])])
        openListNextPageRef.current = nextPage + 1
      }
    } catch {
      message.error('Could not load more invoices')
    } finally {
      setLoadingMoreOpen(false)
    }
  }, [
    isOpenList,
    loading,
    loadingMoreOpen,
    openListTotal,
    records.length,
    listBasePath,
    naListView,
  ])

  const fetchCompRegisterFirstPage = useCallback(async () => {
    setLoading(true)
    setLoadingMoreCompleted(false)
    setRecords([])
    setCompletedRegisterTotal(0)
    compRegisterNextPageRef.current = 2
    try {
      const params: Record<string, string | number> = {
        status: 'completed',
        section: COMP_REGISTER_SECTION,
        page: 1,
        page_size: COMPLETED_REGISTER_PAGE_SIZE,
      }
      if (compRegisterGenre) params.genre = compRegisterGenre
      const r = await apiClient.get<{ items?: ClientPaymentRecord[]; data?: ClientPaymentRecord[]; total?: number }>(
        listBasePath,
        { params },
      )
      const body = r.data
      const chunk = Array.isArray(body?.data) ? body.data : Array.isArray(body?.items) ? body.items : []
      const total = typeof body?.total === 'number' ? body.total : chunk.length
      setRecords(chunk as ClientPaymentRecord[])
      setCompletedRegisterTotal(total)
    } catch {
      setRecords([])
      setCompletedRegisterTotal(0)
      message.warning('Could not load list. Ensure the database tables exist.')
    } finally {
      setLoading(false)
    }
  }, [listBasePath, compRegisterGenre])

  const loadMoreCompRegisterPage = useCallback(async () => {
    if (!isCompRegister) return
    if (loading || loadingMoreCompleted) return
    if (completedRegisterTotal > 0 && records.length >= completedRegisterTotal) return
    const nextPage = compRegisterNextPageRef.current
    if (nextPage < 2) return
    setLoadingMoreCompleted(true)
    try {
      const params: Record<string, string | number> = {
        status: 'completed',
        section: COMP_REGISTER_SECTION,
        page: nextPage,
        page_size: COMPLETED_REGISTER_PAGE_SIZE,
      }
      if (compRegisterGenre) params.genre = compRegisterGenre
      const r = await apiClient.get<{ items?: ClientPaymentRecord[]; data?: ClientPaymentRecord[]; total?: number }>(
        listBasePath,
        { params },
      )
      const body = r.data
      const chunk = Array.isArray(body?.data) ? body.data : Array.isArray(body?.items) ? body.items : []
      if (typeof body?.total === 'number') setCompletedRegisterTotal(body.total)
      if (chunk.length > 0) {
        setRecords((prev) => [...prev, ...(chunk as ClientPaymentRecord[])])
        compRegisterNextPageRef.current = nextPage + 1
      }
    } catch {
      message.error('Could not load more rows')
    } finally {
      setLoadingMoreCompleted(false)
    }
  }, [
    isCompRegister,
    loading,
    loadingMoreCompleted,
    completedRegisterTotal,
    records.length,
    compRegisterGenre,
    listBasePath,
  ])

  const reloadCurrentList = useCallback(() => {
    if (isCompRegister) void fetchCompRegisterFirstPage()
    else void loadOpenListAllPages()
  }, [isCompRegister, fetchCompRegisterFirstPage, loadOpenListAllPages])

  const refreshMarkedNaCapability = useCallback(() => {
    if (!isOpenList) return
    void apiClient
      .get<{ marked_na_supported?: boolean }>(`${listBasePath}/capabilities`)
      .then((r) => {
        if (typeof r.data?.marked_na_supported === 'boolean') {
          setMarkedNaSupported(r.data.marked_na_supported)
        }
      })
      .catch(() => {})
  }, [isOpenList, listBasePath])

  const handleToggleMarkedNa = async (record: ClientPaymentRecord, marked: boolean) => {
    setMarkingNa(true)
    try {
      await apiClient.patch(`/onboarding/client-payment/${record.id}/marked-na`, { marked_na: marked })
      message.success(marked ? 'Marked as NA — removed from list and Total raised' : 'Restored to active list')
      setMarkedNaSupported(true)
      invalidateDashboardPaymentMetrics()
      setKpiRefreshKey((k) => k + 1)
      setDetailOpen(false)
      setSelectedRecord(null)
      reloadCurrentList()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      const detail = err?.response?.data?.detail || 'Failed to update NA status'
      message.error(detail)
      if (String(detail).toLowerCase().includes('client_payment_marked_na')) {
        setMarkedNaSupported(false)
      }
    } finally {
      setMarkingNa(false)
    }
  }

  useEffect(() => {
    refreshMarkedNaCapability()
  }, [refreshMarkedNaCapability])

  useEffect(() => {
    if (isCompRegister) {
      void fetchCompRegisterFirstPage()
      return
    }
    void loadOpenListAllPages()
  }, [location.pathname, compRegisterGenre, isCompRegister, naListView, fetchCompRegisterFirstPage, loadOpenListAllPages])

  useEffect(() => {
    if ((!modalOpen && !editInvoiceModalOpen) || companies.length > 0) return
    setCompaniesLoading(true)
    apiClient
      .get<{ id: string; name: string }[] | { data?: { id: string; name: string }[]; items?: { id: string; name: string }[] }>(
        '/companies/for-invoice',
      )
      .then((r) => r.data)
      .then((companiesList) => {
        const rows = Array.isArray(companiesList)
          ? companiesList
          : Array.isArray(companiesList?.data)
            ? companiesList.data
            : Array.isArray(companiesList?.items)
              ? companiesList.items
              : []
        setCompanies((rows || []).filter((c: { id?: string; name?: string }) => c && c.name))
      })
      .catch(() => setCompanies([]))
      .finally(() => setCompaniesLoading(false))
  }, [modalOpen, editInvoiceModalOpen, companies.length])

  const openModal = () => {
    form.resetFields()
    setModalOpen(true)
  }

  const handleSubmit = () => {
    form.validateFields().then((values) => {
      setSubmitLoading(true)
      const payload = {
        company_name: values.company_name as string,
        invoice_date: values.invoice_date ? (values.invoice_date as Dayjs).format('YYYY-MM-DD') : null,
        invoice_amount: values.invoice_amount != null ? String(values.invoice_amount).trim() : null,
        invoice_number: values.invoice_number != null ? String(values.invoice_number).trim() : null,
        genre: values.genre as 'M' | 'Q' | 'HY' | 'Y',
      }
      apiClient
        .post<ClientPaymentRecord>(API_ENDPOINTS.CLIENT_PAYMENT.CREATE, payload)
        .then(() => {
          message.success('Invoice saved')
          setModalOpen(false)
          form.resetFields()
          reloadCurrentList()
        })
        .catch((err) => {
          const status = err?.response?.status
          const raw = err?.response?.data?.detail
          const detail =
            typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0]?.msg : raw?.message || 'Failed to save invoice'
          if (status === 404 || (typeof detail === 'string' && detail.toLowerCase().includes('not found'))) {
            message.error(
              'Server has no Client Payment API (404). Redeploy the latest backend (Render) with onboarding/client-payment routes. See docs/CLIENT_PAYMENT_PRODUCTION.md'
            )
          } else {
            message.error(detail)
          }
        })
        .finally(() => setSubmitLoading(false))
    }).catch(() => {
      message.warning('Please fill all required fields')
    })
  }

  const openEditInvoiceModal = () => {
    if (!selectedRecord) return
    editInvoiceForm.setFieldsValue({
      company_name: selectedRecord.company_name,
      invoice_date: selectedRecord.invoice_date ? dayjs(selectedRecord.invoice_date) : undefined,
      invoice_amount:
        selectedRecord.invoice_amount != null && String(selectedRecord.invoice_amount).trim() !== ''
          ? Number(String(selectedRecord.invoice_amount).replace(/,/g, ''))
          : undefined,
      invoice_number: selectedRecord.invoice_number ?? '',
      genre: selectedRecord.genre,
    })
    setEditInvoiceModalOpen(true)
  }

  const handleEditInvoiceSubmit = () => {
    if (!selectedRecord?.id) return
    editInvoiceForm.validateFields().then((values) => {
      setEditInvoiceSubmitLoading(true)
      const payload = {
        company_name: values.company_name as string,
        invoice_date: values.invoice_date ? (values.invoice_date as Dayjs).format('YYYY-MM-DD') : null,
        invoice_amount: values.invoice_amount != null ? String(values.invoice_amount).trim() : null,
        invoice_number: values.invoice_number != null ? String(values.invoice_number).trim() : null,
        genre: values.genre as 'M' | 'Q' | 'HY' | 'Y',
      }
      apiClient
        .put<ClientPaymentRecord>(API_ENDPOINTS.CLIENT_PAYMENT.UPDATE(selectedRecord.id), payload)
        .then((res) => {
          const updated = res.data
          message.success('Invoice updated')
          setEditInvoiceModalOpen(false)
          editInvoiceForm.resetFields()
          const merged: ClientPaymentRecord = { ...selectedRecord, ...updated }
          setSelectedRecord(merged)
          loadDrawerData(merged)
          reloadCurrentList()
        })
        .catch((err) => {
          const raw = err?.response?.data?.detail
          const detail =
            typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0]?.msg : raw?.message || 'Failed to update invoice'
          message.error(detail)
        })
        .finally(() => setEditInvoiceSubmitLoading(false))
    }).catch(() => {
      message.warning('Please fill all required fields')
    })
  }

  const loadDrawerData = (record: ClientPaymentRecord) => {
    if (!record?.id) return
    setDrawerStatusLoading(true)
    setSentSummary(null)
    setSentDetails(null)
    setSentSubmitted(false)
    setFollowupSummary(null)
    setFollowupDetails(null)
    setFollowupSubmitted(false)
    setFollowupsItems([])
    setNextFollowupNo(1)
    setInterceptSubmitted(false)
    setInterceptDetails(null)
    setInterceptEditable(true)
    setDiscontinuationSubmitted(false)
    setDiscontinuationDetails(null)
    setPaymentReceiveSubmitted(false)
    setPaymentReceiveDetails(null)
    setPaymentReceiveCreatedAt(null)
    type DrawerRes = {
      sent?: { data?: any; editable_24h?: boolean; submitted?: boolean }
      followups?: { items?: any[]; next_followup_no?: number }
      intercept?: { data?: any; submitted?: boolean; editable_24h?: boolean }
      discontinuation?: { data?: any; submitted?: boolean }
      payment_receive?: {
        data?: {
          party_name?: string | null
          invoice_number?: string | null
          amount?: number | string | null
          payment_date?: string | null
        }
        submitted?: boolean
        created_at?: string | null
      }
    }
    apiClient
      .get<DrawerRes>(`/onboarding/client-payment/${record.id}/drawer`)
      .then((res) => {
        const sentRes = res.data?.sent
        const followupsRes = res.data?.followups
        const interceptRes = res.data?.intercept
        const discontinuationRes = res.data?.discontinuation
        const paymentReceiveRes = res.data?.payment_receive
        const sentData = sentRes?.data || {}
        setSentSummary({
          email_sent: !!sentData.email_sent,
          courier_sent: !!sentData.courier_sent,
          whatsapp_sent: !!sentData.whatsapp_sent,
        })
        setSentDetails({
          email: sentData.email ?? null,
          tracking_details: sentData.tracking_details ?? null,
          whatsapp_number: sentData.whatsapp_number ?? null,
        })
        setSentSubmitted(!!sentRes?.submitted)
        setSentEditable(sentRes?.editable_24h ?? true)
        sentForm.setFieldsValue({
          email_sent: sentData.email_sent ?? false,
          email: sentData.email ?? '',
          courier_sent: sentData.courier_sent ?? false,
          tracking_details: sentData.tracking_details ?? '',
          whatsapp_sent: sentData.whatsapp_sent ?? false,
          whatsapp_number: sentData.whatsapp_number ?? '',
          invoice_number: record.invoice_number ?? sentData.invoice_number ?? '',
        })
        const items = followupsRes?.items || []
        setFollowupsItems(items)
        setNextFollowupNo(Math.min(followupsRes?.next_followup_no ?? 1, 11))
        setFollowupSubmitted(items.length > 0)
        const lastFu = items.slice(-1)[0]
        if (lastFu) {
          setFollowupSummary({ contact_person: lastFu.contact_person ?? null, mail_sent: !!lastFu.mail_sent, whatsapp_sent: !!lastFu.whatsapp_sent })
          setFollowupDetails({ remarks: lastFu.remarks ?? null })
          setFollowupEditable(lastFu.editable_24h ?? false)
        }
        setInterceptSubmitted(!!interceptRes?.submitted)
        const i = interceptRes?.data || {}
        setInterceptEditable(interceptRes?.editable_24h ?? true)
        setInterceptDetails({
          last_remark_user: i.last_remark_user ?? null,
          usage_last_1_month: i.usage_last_1_month ?? null,
          contact_person: i.contact_person ?? null,
          contact_number: i.contact_number ?? null,
          tagged_user_id: i.tagged_user_id ?? null,
          tagged_user_name: i.tagged_user_name ?? null,
          tagged_user_email: i.tagged_user_email ?? null,
          tagged_user_2_id: i.tagged_user_2_id ?? null,
          tagged_user_2_name: i.tagged_user_2_name ?? null,
          tagged_user_2_email: i.tagged_user_2_email ?? null,
          payment_action_person: i.payment_action_person ?? null,
          payment_action_remarks: i.payment_action_remarks ?? null,
          payment_action_submitted_at: i.payment_action_submitted_at ?? null,
          payment_action_2_person: i.payment_action_2_person ?? null,
          payment_action_2_remarks: i.payment_action_2_remarks ?? null,
          payment_action_2_submitted_at: i.payment_action_2_submitted_at ?? null,
        })
        setDiscontinuationSubmitted(!!discontinuationRes?.submitted)
        const d = discontinuationRes?.data || {}
        setDiscontinuationDetails({
          mail_sent_to: d.mail_sent_to ?? null,
          mail_sent_on: d.mail_sent_on ?? null,
          remarks: d.remarks ?? null,
        })
        const pr = paymentReceiveRes?.data || {}
        setPaymentReceiveSubmitted(!!paymentReceiveRes?.submitted)
        setPaymentReceiveDetails({
          party_name: pr.party_name ?? null,
          invoice_number: pr.invoice_number ?? null,
          amount: pr.amount ?? null,
          payment_date: pr.payment_date ?? null,
        })
        setPaymentReceiveCreatedAt(paymentReceiveRes?.created_at ?? null)
      })
      .catch(() => message.error('Could not load invoice details'))
      .finally(() => setDrawerStatusLoading(false))
  }

  const loadSentDetails = (openModal: boolean, options?: { silent?: boolean }) => {
    if (!selectedRecord) return
    if (!options?.silent) setSentLoading(true)
    const sentUrl = `/onboarding/client-payment/${selectedRecord.id}/sent`
    const fuUrl = `/onboarding/client-payment/${selectedRecord.id}/followups`
    Promise.all([
      apiClient.get<{ data: any; created_at: string | null; editable_until: string | null; editable_24h: boolean; submitted?: boolean }>(sentUrl),
      apiClient.get<{ items?: any[]; next_followup_no?: number }>(fuUrl),
    ])
      .then(([res, fuRes]) => {
        const data = res.data?.data || {}
        sentForm.setFieldsValue({
          email_sent: data.email_sent ?? false,
          email: data.email ?? '',
          courier_sent: data.courier_sent ?? false,
          tracking_details: data.tracking_details ?? '',
          whatsapp_sent: data.whatsapp_sent ?? false,
          whatsapp_number: data.whatsapp_number ?? '',
          invoice_number: selectedRecord.invoice_number ?? data.invoice_number ?? '',
        })
        setSentSummary({
          email_sent: !!data.email_sent,
          courier_sent: !!data.courier_sent,
          whatsapp_sent: !!data.whatsapp_sent,
        })
        setSentDetails({
          email: data.email ?? null,
          tracking_details: data.tracking_details ?? null,
          whatsapp_number: data.whatsapp_number ?? null,
        })
        setSentSubmitted(!!res.data?.submitted)
        setSentEditable(res.data?.editable_24h ?? true)
        const items = fuRes.data?.items || []
        setFollowupsItems(items)
        setNextFollowupNo(Math.min(fuRes.data?.next_followup_no ?? 1, 11))
        sentInlineFollowupForm.resetFields()
        if (openModal) setSentModalOpen(true)
      })
      .catch(() => message.error('Could not load Invoice Sent details'))
      .finally(() => {
        if (!options?.silent) setSentLoading(false)
      })
  }

  const openSentDetails = () => {
    loadSentDetails(true)
  }

  const handleSentSubmit = () => {
    if (!selectedRecord) return
    sentForm
      .validateFields()
      .then((values) => {
        setSentLoading(true)
        // Always use invoice number from the Raised Invoice record; do not allow editing here
        const payload = {
          ...values,
          invoice_number: selectedRecord.invoice_number ?? '',
        }
        apiClient
          .post(`/onboarding/client-payment/${selectedRecord.id}/sent`, { data: payload })
          .then((res) => {
            message.success('Invoice Sent details saved')
            const data = res.data?.data || payload
            setSentSummary({
              email_sent: !!data.email_sent,
              courier_sent: !!data.courier_sent,
              whatsapp_sent: !!data.whatsapp_sent,
            })
            setSentDetails({
              email: data.email ?? null,
              tracking_details: data.tracking_details ?? null,
              whatsapp_number: data.whatsapp_number ?? null,
            })
            setSentSubmitted(true)
            setSentModalOpen(false)
            reloadCurrentList()
          })
          .catch((err) => {
            const detail = err?.response?.data?.detail || 'Failed to save Invoice Sent details'
            message.error(detail)
          })
          .finally(() => setSentLoading(false))
      })
      .catch(() => {})
  }

  const openFollowup = (followupNo: number) => {
    if (!selectedRecord) return
    setCurrentFollowupNo(followupNo)
    setFollowupEditable(true)
    setFollowupLoading(true)
    apiClient
      .get<{ data: any; submitted?: boolean; editable_24h?: boolean }>(`/onboarding/client-payment/${selectedRecord.id}/followups/${followupNo}`)
      .then((res) => {
        const data = res.data?.data || {}
        followupForm.setFieldsValue({
          contact_person: data.contact_person ?? '',
          remarks: data.remarks ?? '',
          mail_sent: data.mail_sent ?? false,
          whatsapp_sent: data.whatsapp_sent ?? false,
          followup_timestamp: data.followup_timestamp ? dayjs(data.followup_timestamp) : undefined,
        })
        setFollowupEditable(res.data?.submitted ? (res.data?.editable_24h ?? true) : true)
        setFollowupModalOpen(true)
      })
      .catch(() => message.error('Could not load Follow up details'))
      .finally(() => setFollowupLoading(false))
  }

  const buildFollowupApiPayload = (values: Record<string, unknown>, followupNo: number) => ({
    contact_person: values.contact_person,
    remarks: values.remarks,
    mail_sent: values.mail_sent,
    whatsapp_sent: values.whatsapp_sent,
    followup_timestamp: values.followup_timestamp
      ? (values.followup_timestamp as Dayjs).toISOString()
      : undefined,
    followup_no: followupNo,
  })

  const handleFollowupSubmit = () => {
    if (!selectedRecord) return
    followupForm.validateFields().then((values) => {
      setFollowupLoading(true)
      const payload = buildFollowupApiPayload(values as Record<string, unknown>, currentFollowupNo)
      apiClient
        .post(`/onboarding/client-payment/${selectedRecord.id}/followups`, { data: payload })
        .then(() => {
          message.success(`Follow up ${currentFollowupNo} saved`)
          setFollowupModalOpen(false)
          loadDrawerData(selectedRecord)
          reloadCurrentList()
          if (sentModalOpen) loadSentDetails(false, { silent: true })
        })
        .catch((err) => message.error(err?.response?.data?.detail || 'Failed to save'))
        .finally(() => setFollowupLoading(false))
    }).catch(() => {})
  }

  const handleSentModalInlineFollowupSave = () => {
    if (!selectedRecord || nextFollowupNo > 10) return
    sentInlineFollowupForm.validateFields().then((values) => {
      setFollowupLoading(true)
      const payload = buildFollowupApiPayload(values as Record<string, unknown>, nextFollowupNo)
      apiClient
        .post(`/onboarding/client-payment/${selectedRecord.id}/followups`, { data: payload })
        .then(() => {
          message.success(`Follow up ${nextFollowupNo} saved`)
          loadDrawerData(selectedRecord)
          reloadCurrentList()
          loadSentDetails(false, { silent: true })
        })
        .catch((err) => message.error(err?.response?.data?.detail || 'Failed to save'))
        .finally(() => setFollowupLoading(false))
    }).catch(() => {})
  }

  const openIntercept = () => {
    if (!selectedRecord) return
    apiClient.get<{ data: any; editable_24h?: boolean; submitted?: boolean }>(`/onboarding/client-payment/${selectedRecord.id}/intercept`).then((res) => {
      const d = res.data?.data || {}
      setInterceptEditable(res.data?.editable_24h ?? true)
      interceptForm.setFieldsValue({ last_remark_user: d.last_remark_user ?? '', usage_last_1_month: d.usage_last_1_month ?? '', contact_person: d.contact_person ?? '', contact_number: d.contact_number ?? '' })
      setInterceptDetails({
        last_remark_user: d.last_remark_user ?? null,
        usage_last_1_month: d.usage_last_1_month ?? null,
        contact_person: d.contact_person ?? null,
        contact_number: d.contact_number ?? null,
        tagged_user_id: d.tagged_user_id ?? null,
        tagged_user_name: d.tagged_user_name ?? null,
        tagged_user_email: d.tagged_user_email ?? null,
        tagged_user_2_id: d.tagged_user_2_id ?? null,
        tagged_user_2_name: d.tagged_user_2_name ?? null,
        tagged_user_2_email: d.tagged_user_2_email ?? null,
        payment_action_person: d.payment_action_person ?? null,
        payment_action_remarks: d.payment_action_remarks ?? null,
        payment_action_submitted_at: d.payment_action_submitted_at ?? null,
        payment_action_2_person: d.payment_action_2_person ?? null,
        payment_action_2_remarks: d.payment_action_2_remarks ?? null,
        payment_action_2_submitted_at: d.payment_action_2_submitted_at ?? null,
      })
      setInterceptModalOpen(true)
    }).catch(() => message.error('Could not load'))
  }

  const openInterceptTag = () => {
    if (!selectedRecord) return
    setInterceptTagModalOpen(true)
    setTagSelectedUserId(interceptDetails?.tagged_user_id ?? null)
    if (tagUsers.length > 0) return
    setTagLoading(true)
    apiClient
      .get<{ items?: { id: string; full_name: string; email: string }[]; data?: { id: string; full_name: string; email: string }[] }>('/users/options')
      .then((res) => {
        const rows = Array.isArray(res.data?.data)
          ? res.data.data
          : Array.isArray(res.data?.items)
            ? res.data.items
            : []
        setTagUsers(rows)
      })
      .catch(() => setTagUsers([]))
      .finally(() => setTagLoading(false))
  }

  const saveInterceptTag = () => {
    if (!selectedRecord) return
    if (!tagSelectedUserId) {
      message.warning('Select a user to tag')
      return
    }
    const u = tagUsers.find((x) => x.id === tagSelectedUserId)
    if (!u) return
    const payload = {
      last_remark_user: interceptDetails?.last_remark_user ?? null,
      usage_last_1_month: interceptDetails?.usage_last_1_month ?? null,
      contact_person: interceptDetails?.contact_person ?? null,
      contact_number: interceptDetails?.contact_number ?? null,
      tagged_user_id: u.id,
      tagged_user_name: u.full_name,
      tagged_user_email: u.email,
    }
    setTagLoading(true)
    apiClient
      .post(`/onboarding/client-payment/${selectedRecord.id}/intercept`, { data: payload })
      .then(() => {
        message.success('Tagged user saved')
        setInterceptSubmitted(true)
        setInterceptDetails(payload)
        setInterceptTagModalOpen(false)
        loadDrawerData(selectedRecord)
      })
      .catch((e) => message.error(e?.response?.data?.detail || 'Failed to save tag'))
      .finally(() => setTagLoading(false))
  }

  const openInterceptTag2 = () => {
    if (!selectedRecord) return
    setInterceptTag2ModalOpen(true)
    setTag2SelectedUserId(interceptDetails?.tagged_user_2_id ?? null)
    if (tagUsers.length > 0) return
    setTagLoading(true)
    apiClient
      .get<{ items?: { id: string; full_name: string; email: string }[]; data?: { id: string; full_name: string; email: string }[] }>('/users/options')
      .then((res) => {
        const rows = Array.isArray(res.data?.data)
          ? res.data.data
          : Array.isArray(res.data?.items)
            ? res.data.items
            : []
        setTagUsers(rows)
      })
      .catch(() => setTagUsers([]))
      .finally(() => setTagLoading(false))
  }

  const saveInterceptTag2 = () => {
    if (!selectedRecord) return
    if (!tag2SelectedUserId) {
      message.warning('Select a user to tag')
      return
    }
    setTagLoading(true)
    apiClient
      .post(`/onboarding/client-payment/${selectedRecord.id}/intercept/tag-2`, { data: { tagged_user_id: tag2SelectedUserId } })
      .then(() => {
        message.success('Tag 2 saved')
        setInterceptTag2ModalOpen(false)
        loadDrawerData(selectedRecord)
      })
      .catch((e) => message.error(e?.response?.data?.detail || 'Failed to save Tag 2'))
      .finally(() => setTagLoading(false))
  }

  const handleInterceptSubmit = () => {
    if (!selectedRecord) return
    interceptForm.validateFields().then((values) => {
      apiClient.post(`/onboarding/client-payment/${selectedRecord.id}/intercept`, { data: values }).then(() => {
        message.success('Intercept Requirements saved')
        setInterceptSubmitted(true)
        setInterceptModalOpen(false)
        loadDrawerData(selectedRecord)
      }).catch((e) => message.error(e?.response?.data?.detail || 'Failed to save'))
    }).catch(() => {})
  }

  const openDiscontinuation = () => {
    if (!selectedRecord) return
    apiClient.get<{ data: any }>(`/onboarding/client-payment/${selectedRecord.id}/discontinuation`).then((res) => {
      const d = res.data?.data || {}
      discontinuationForm.setFieldsValue({ mail_sent_to: d.mail_sent_to ?? '', mail_sent_on: d.mail_sent_on ? dayjs(d.mail_sent_on) : null, remarks: d.remarks ?? '' })
      setDiscontinuationDetails({
        mail_sent_to: d.mail_sent_to ?? null,
        mail_sent_on: d.mail_sent_on ?? null,
        remarks: d.remarks ?? null,
      })
      setDiscontinuationModalOpen(true)
    }).catch(() => message.error('Could not load'))
  }
  const handleDiscontinuationSubmit = () => {
    if (!selectedRecord) return
    discontinuationForm.validateFields().then((values) => {
      const data = { ...values, mail_sent_on: values.mail_sent_on ? (values.mail_sent_on as Dayjs).format('YYYY-MM-DD') : null }
      apiClient.post(`/onboarding/client-payment/${selectedRecord.id}/discontinuation`, { data }).then(() => {
        message.success('Discontinuation Mail saved')
        setDiscontinuationSubmitted(true)
        setDiscontinuationModalOpen(false)
        loadDrawerData(selectedRecord)
      }).catch((e) => message.error(e?.response?.data?.detail || 'Failed to save'))
    }).catch(() => {})
  }

  const openPaymRec = () => {
    if (!selectedRecord) return
    paymRecForm.setFieldsValue({
      party_name: selectedRecord.company_name ?? '',
      invoice_number: selectedRecord.invoice_number ?? '',
      amount: selectedRecord.invoice_amount ?? '',
      payment_date: null,
    })
    setPaymRecModalOpen(true)
  }
  const handlePaymRecSubmit = () => {
    if (!selectedRecord) return
    paymRecForm.validateFields().then((values) => {
      const data = { party_name: values.party_name, invoice_number: String(values.invoice_number || '').trim(), amount: Number(values.amount), payment_date: (values.payment_date as Dayjs).format('YYYY-MM-DD') }
      apiClient.post(`/onboarding/client-payment/${selectedRecord.id}/payment-receive`, { data }).then(() => {
        message.success('Payment Receive Details saved – invoice completed')
        invalidateDashboardPaymentMetrics()
        setPaymRecModalOpen(false)
        setDetailOpen(false)
        setSelectedRecord(null)
        reloadCurrentList()
      }).catch((e) => message.error(e?.response?.data?.detail || 'Failed to save'))
    }).catch(() => {})
  }

  const buildColumnFilters = (values: Array<string | number | null | undefined>) => {
    const uniq = Array.from(
      new Set(
        values
          .map((v) => (v === null || v === undefined || String(v).trim() === '' ? '—' : String(v)))
          .filter(Boolean),
      ),
    )
    return uniq.sort((a, b) => a.localeCompare(b)).map((v) => ({ text: v, value: v }))
  }

  const genreLabel = (v: string | null | undefined) => {
    const map: Record<string, string> = { M: 'Monthly', Q: 'Quarterly', HY: 'Half yearly', Y: 'Yearly' }
    return map[String(v || '')] || v || '—'
  }

  const columns = [
    {
      title: 'Reference',
      dataIndex: 'reference_no',
      key: 'reference_no',
      width: 150,
      ellipsis: true,
      render: (v: string | null | undefined) => v || '—',
      filters: buildColumnFilters(records.map((r) => r.reference_no || '—')),
      filterSearch: true,
      filterMultiple: true,
      onFilter: (value: string | number | boolean, record: ClientPaymentRecord) => (record.reference_no || '—') === String(value),
    },
    {
      title: 'Company Name',
      dataIndex: 'company_name',
      key: 'company_name',
      width: 280,
      ellipsis: true,
      filters: buildColumnFilters(records.map((r) => r.company_name || '—')),
      filterSearch: true,
      filterMultiple: true,
      onFilter: (value: string | number | boolean, record: ClientPaymentRecord) => (record.company_name || '—') === String(value),
    },
    {
      title: 'Invoice Date',
      dataIndex: 'invoice_date',
      key: 'invoice_date',
      width: 128,
      ellipsis: true,
      render: (v: string | null) => (v ? dayjs(v).format('DD-MMM-YYYY') : '—'),
      filters: buildColumnFilters(records.map((r) => (r.invoice_date ? dayjs(r.invoice_date).format('DD-MMM-YYYY') : '—'))),
      filterSearch: true,
      filterMultiple: true,
      onFilter: (value: string | number | boolean, record: ClientPaymentRecord) =>
        (record.invoice_date ? dayjs(record.invoice_date).format('DD-MMM-YYYY') : '—') === String(value),
    },
    {
      title: 'Invoice Amount',
      dataIndex: 'invoice_amount',
      key: 'invoice_amount',
      width: 128,
      ellipsis: true,
      filters: buildColumnFilters(records.map((r) => r.invoice_amount || '—')),
      filterSearch: true,
      filterMultiple: true,
      onFilter: (value: string | number | boolean, record: ClientPaymentRecord) => (record.invoice_amount || '—') === String(value),
    },
    {
      title: 'Invoice Number',
      dataIndex: 'invoice_number',
      key: 'invoice_number',
      width: 200,
      ellipsis: true,
      filters: buildColumnFilters(records.map((r) => r.invoice_number || '—')),
      filterSearch: true,
      filterMultiple: true,
      onFilter: (value: string | number | boolean, record: ClientPaymentRecord) => (record.invoice_number || '—') === String(value),
    },
    {
      title: 'Stage',
      dataIndex: 'stage',
      key: 'stage',
      width: 220,
      ellipsis: true,
      render: (v: string | null | undefined) => v || '—',
      filters: buildColumnFilters(records.map((r) => r.stage || '—')),
      filterSearch: true,
      filterMultiple: true,
      onFilter: (value: string | number | boolean, record: ClientPaymentRecord) => (record.stage || '—') === String(value),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 108,
      ellipsis: true,
      render: (v: string | null | undefined) => v || 'Pending',
      filters: buildColumnFilters(records.map((r) => r.status || 'Pending')),
      filterSearch: true,
      filterMultiple: true,
      onFilter: (value: string | number | boolean, record: ClientPaymentRecord) => (record.status || 'Pending') === String(value),
    },
    {
      title: 'Aging (days)',
      dataIndex: 'aging_days',
      key: 'aging_days',
      width: 112,
      render: (v: number | null | undefined) => (typeof v === 'number' ? v : 0),
      filters: buildColumnFilters(records.map((r) => (typeof r.aging_days === 'number' ? r.aging_days : 0))),
      filterSearch: true,
      filterMultiple: true,
      onFilter: (value: string | number | boolean, record: ClientPaymentRecord) =>
        String(typeof record.aging_days === 'number' ? record.aging_days : 0) === String(value),
    },
    {
      title: 'Genre',
      dataIndex: 'genre',
      key: 'genre',
      width: 120,
      ellipsis: true,
      render: (v: string) => genreLabel(v),
      filters: buildColumnFilters(records.map((r) => genreLabel(r.genre))),
      filterSearch: true,
      filterMultiple: true,
      onFilter: (value: string | number | boolean, record: ClientPaymentRecord) => genreLabel(record.genre) === String(value),
    },
  ] as ColumnsType<ClientPaymentRecord>

  const exportColumns: ExportColumn<ClientPaymentRecord>[] = [
    { key: 'timestamp', label: 'Timestamp', getValue: (r) => (r.timestamp ? dayjs(r.timestamp).format('DD-MMM-YYYY HH:mm') : '—') },
    { key: 'reference_no', label: 'Reference', getValue: (r) => r.reference_no || '—' },
    { key: 'company_name', label: 'Company Name', getValue: (r) => r.company_name || '—' },
    { key: 'invoice_date', label: 'Invoice Date', getValue: (r) => (r.invoice_date ? dayjs(r.invoice_date).format('DD-MMM-YYYY') : '—') },
    { key: 'invoice_amount', label: 'Invoice Amount', getValue: (r) => r.invoice_amount || '—' },
    { key: 'invoice_number', label: 'Invoice Number', getValue: (r) => r.invoice_number || '—' },
    { key: 'stage', label: 'Stage', getValue: (r) => r.stage || '—' },
    { key: 'status', label: 'Status', getValue: (r) => r.status || 'Pending' },
    { key: 'aging_days', label: 'Aging (days)', getValue: (r) => (typeof r.aging_days === 'number' ? r.aging_days : 0) },
    { key: 'genre', label: 'Genre', getValue: (r) => genreLabel(r.genre) },
  ]
  const exportOptions = exportColumns.map((c) => ({ label: c.label, value: c.key }))

  const openExport = () => {
    setSelectedExportColumns(exportColumns.map((c) => c.key))
    setExportOpen(true)
  }

  const handleExport = () => {
    const cols = exportColumns.filter((c) => selectedExportColumns.includes(c.key))
    if (!cols.length) {
      message.warning('Select at least one column to export')
      return
    }
    const sectionLabel = completedSection ? completedSection : 'payment-management'
    exportRowsToCsv({
      filename: `client-payment-${sectionLabel}-${dayjs().format('YYYYMMDD-HHmm')}.csv`,
      columns: cols,
      rows: filteredRecords,
    })
    setExportOpen(false)
    message.success('Export started')
  }

  const pageTitle = isCompRegister ? 'Comp _ Register' : completedSection ? completedSection.replace(/-/g, ' ') : 'Payment Management'
  const dayOfMonth = new Date().getDate()
  const showInterceptByDate = dayOfMonth >= 20

  /** Hide "Tag" after Tag user (Intercept Requirements) has been saved once. */
  const interceptHasTaggedUser = !!(
    interceptDetails?.tagged_user_id ||
    interceptDetails?.tagged_user_name ||
    interceptDetails?.tagged_user_email
  )
  const interceptHasTaggedUser2 = !!(
    interceptDetails?.tagged_user_2_id ||
    interceptDetails?.tagged_user_2_name ||
    interceptDetails?.tagged_user_2_email
  )
  const showClientPaymentT2Button =
    !!user &&
    interceptHasTaggedUser &&
    !!interceptDetails?.payment_action_submitted_at &&
    !interceptHasTaggedUser2
  const showDiscontinuationByDate = dayOfMonth >= 25
  const isCompleted = selectedRecord?.status === 'Completed'
  /** Core "Add Invoice" fields: editable within 150 days of row Timestamp (Payment Management / open list only). */
  const daysSinceCreated = selectedRecord?.timestamp ? dayjs().diff(dayjs(selectedRecord.timestamp), 'day') : 999
  const canEditRaisedInvoiceCore =
    isOpenList &&
    !!selectedRecord &&
    !isCompleted &&
    daysSinceCreated >= 0 &&
    daysSinceCreated <= CLIENT_PAYMENT_EDIT_DAYS

  const companyFilterNorm = companyNameFilter.trim().toLowerCase()
  const filteredRecords = useMemo(() => {
    let list = records
    if (companyFilterNorm) {
      list = list.filter((r) => (r.company_name || '').toLowerCase().includes(companyFilterNorm))
    }
    if (awaitingPaymentReceiveOnly && isOpenList) {
      list = list.filter((r) => r.invoice_sent_submitted && r.status !== 'Completed')
    }
    return list
  }, [records, companyFilterNorm, awaitingPaymentReceiveOnly, isOpenList])

  const awaitingPaymentReceiveCount = useMemo(
    () => records.filter((r) => r.invoice_sent_submitted && r.status !== 'Completed').length,
    [records],
  )

  const clientPaymentChunkSize = isCompRegister ? Math.max(filteredRecords.length, 1) : DEFAULT_INFINITE_CHUNK

  const {
    visibleItems: visibleFilteredRecords,
    containerRef: clientPaymentTableContainerRef,
    sentinelRef: clientPaymentTableSentinelRef,
    total: totalFilteredRecords,
    visibleCount: visibleFilteredRecordCount,
    hasMore: filteredRecordsHasMore,
  } = useInfiniteScrollChunk({
    items: filteredRecords,
    chunkSize: clientPaymentChunkSize,
    loading: isCompRegister ? false : loading,
  })

  const tableRows = isCompRegister ? filteredRecords : visibleFilteredRecords

  useEffect(() => {
    if (!isCompRegister) return
    if (loading) return
    const sentinel = clientPaymentTableSentinelRef.current
    if (!sentinel) return
    if (completedRegisterTotal > 0 && records.length >= completedRegisterTotal) return
    const tableBodyRoot = clientPaymentTableContainerRef.current?.querySelector('.ant-table-body') as HTMLElement | null
    const root = tableBodyRoot && tableBodyRoot.contains(sentinel) ? tableBodyRoot : null
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        void loadMoreCompRegisterPage()
      },
      { root, rootMargin: '200px', threshold: 0 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [
    isCompRegister,
    loading,
    loadingMoreCompleted,
    records.length,
    completedRegisterTotal,
    filteredRecords.length,
    loadMoreCompRegisterPage,
    compRegisterGenre,
  ])

  const compRegisterHasMoreServer =
    isCompRegister && completedRegisterTotal > 0 && records.length < completedRegisterTotal
  const openListHasMoreServer =
    isOpenList && openListTotal > 0 && records.length < openListTotal

  return (
    <div style={{ padding: 24 }}>
      <Space
        className="page-toolbar-row"
        style={{ marginBottom: 24, width: '100%', alignItems: 'center' }}
        wrap
        size="middle"
      >
        <Title level={4} className="page-main-heading" style={{ margin: 0 }}>
          {pageTitle}
        </Title>
        <OperationsSectionTabs module="client-payment" />
        <Space wrap align="center" size="middle">
          {isOpenList ? (
            <>
              <Select
                aria-label="Invoice list filter"
                style={{ width: 168 }}
                value={naListView}
                options={[
                  { value: 'active', label: 'Active invoices' },
                  { value: 'na', label: 'NA only' },
                ]}
                onChange={(v) => setNaListView(v as 'active' | 'na')}
                disabled={!markedNaSupported}
                title={
                  markedNaSupported
                    ? undefined
                    : 'Run database/CLIENT_PAYMENT_MARKED_NA.sql in Supabase to enable NA filter'
                }
              />
              <Checkbox checked={awaitingPaymentReceiveOnly} onChange={(e) => setAwaitingPaymentReceiveOnly(e.target.checked)}>
                Awaiting Payment Received
              </Checkbox>
              <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
                {awaitingPaymentReceiveCount} row{awaitingPaymentReceiveCount === 1 ? '' : 's'} need Payment Received
              </Text>
            </>
          ) : null}
          {isCompRegister ? (
            <Select
              aria-label="Filter completed invoices by genre"
              style={{ width: 240 }}
              value={compRegisterGenre || 'all'}
              options={[
                { value: 'all', label: 'All genres (Q + M + HY)' },
                { value: 'Q', label: 'Quarterly (Q)' },
                { value: 'M', label: 'Monthly (M)' },
                { value: 'HY', label: 'Half yearly (HY)' },
                { value: 'Y', label: 'Yearly (Y)' },
              ]}
              onChange={(v) => {
                if (v === 'all') setSearchParams({}, { replace: true })
                else setSearchParams({ genre: String(v) }, { replace: true })
              }}
            />
          ) : null}
          <Input.Search
            allowClear
            placeholder="Search company name"
            style={{ width: 'min(100vw - 48px, 320px)', minWidth: 200 }}
            value={companyNameFilter}
            onChange={(e) => setCompanyNameFilter(e.target.value)}
            onSearch={(v) => setCompanyNameFilter(v)}
            aria-label="Filter invoices by company name"
          />
          {companyFilterNorm ? (
            <Text type="secondary">
              {filteredRecords.length} of {records.length} rows
            </Text>
          ) : null}
          {isOpenList && (
            <Button type="primary" onClick={openModal}>
              Add Invoice
            </Button>
          )}
          <Button onClick={openExport}>Export</Button>
        </Space>
      </Space>

      {isOpenList ? (
        <div style={{ marginBottom: 24 }}>
          <PaymentAmountKpiCards loadFromApi refreshKey={kpiRefreshKey} />
        </div>
      ) : null}

      <Card>
        <TableWithSkeletonLoading loading={loading} columns={9} rows={12}>
          <div ref={clientPaymentTableContainerRef}>
            <Table
              dataSource={tableRows}
              columns={columns}
              rowKey="id"
              loading={false}
              scroll={{ x: 1460, y: 600 }}
              tableLayout="fixed"
              pagination={false}
              summary={() => (
                <Table.Summary>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={columns.length}>
                      <div ref={clientPaymentTableSentinelRef} style={{ height: 8, minHeight: 8 }} aria-hidden />
                      <Text type="secondary">
                        {isCompRegister ? (
                          <>
                            Showing {filteredRecords.length} of {completedRegisterTotal} completed
                            {loadingMoreCompleted ? ' · loading more…' : null}
                            {!loadingMoreCompleted && compRegisterHasMoreServer ? ' · scroll for more' : null}
                          </>
                        ) : (
                          <>
                            Showing {visibleFilteredRecordCount} of {companyFilterNorm || awaitingPaymentReceiveOnly ? totalFilteredRecords : openListTotal || totalFilteredRecords} rows
                            {filteredRecordsHasMore ? ' · scroll to show loaded rows' : ''}
                            {!companyFilterNorm && !awaitingPaymentReceiveOnly && openListHasMoreServer ? (
                              <Button
                                size="small"
                                type="link"
                                loading={loadingMoreOpen}
                                onClick={() => void loadMoreOpenListPage()}
                                style={{ paddingInline: 8 }}
                              >
                                Load more invoices
                              </Button>
                            ) : null}
                          </>
                        )}
                      </Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
              onRow={(record) => ({
                onClick: () => {
                  setSelectedRecord(record)
                  setDetailOpen(true)
                  loadDrawerData(record)
                },
                style: { cursor: 'pointer' },
              })}
            />
          </div>
        </TableWithSkeletonLoading>
      </Card>

      <Drawer
        title={selectedRecord ? `${selectedRecord.reference_no ?? 'Invoice'} – ${selectedRecord.company_name}` : 'Invoice Details'}
        open={detailOpen}
        width={520}
        onClose={() => {
          setDetailOpen(false)
          setSelectedRecord(null)
        }}
      >
        {selectedRecord && (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Timestamp">
                {selectedRecord.timestamp ? dayjs(selectedRecord.timestamp).format('DD-MMM-YYYY HH:mm') : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Reference">{selectedRecord.reference_no || '—'}</Descriptions.Item>
              <Descriptions.Item label="Company Name">{selectedRecord.company_name || '—'}</Descriptions.Item>
              <Descriptions.Item label="Invoice Date">
                {selectedRecord.invoice_date ? dayjs(selectedRecord.invoice_date).format('DD-MMM-YYYY') : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Invoice Amount">{selectedRecord.invoice_amount || '—'}</Descriptions.Item>
              <Descriptions.Item label="Invoice Number">{selectedRecord.invoice_number || '—'}</Descriptions.Item>
              <Descriptions.Item label="Genre">{selectedRecord.genre || '—'}</Descriptions.Item>
              <Descriptions.Item label="Stage">{selectedRecord.stage || '—'}</Descriptions.Item>
              <Descriptions.Item label="Status">{selectedRecord.status || 'Pending'}</Descriptions.Item>
              <Descriptions.Item label="Aging (days)">
                {typeof selectedRecord.aging_days === 'number' ? selectedRecord.aging_days : 0}
              </Descriptions.Item>
            </Descriptions>
            {isOpenList && !isCompleted && (
              <div style={{ marginTop: 16 }}>
                {selectedRecord.marked_na || naListView === 'na' ? (
                  <Button loading={markingNa} onClick={() => void handleToggleMarkedNa(selectedRecord, false)}>
                    Restore
                  </Button>
                ) : (
                  <Button
                    danger
                    loading={markingNa}
                    onClick={() => {
                      if (!markedNaSupported) {
                        message.warning('Run database/CLIENT_PAYMENT_MARKED_NA.sql in Supabase to enable NA.')
                        return
                      }
                      Modal.confirm({
                        title: 'Mark as NA?',
                        content: (
                          <>
                            This removes this invoice from the active list and subtracts ₹
                            {selectedRecord.invoice_amount || '—'} from <strong>Total raised</strong> in the KPI cards.
                            Use the <strong>NA only</strong> filter at the top to view NA-marked invoices later.
                          </>
                        ),
                        okText: 'NA',
                        okButtonProps: { danger: true },
                        onOk: () => handleToggleMarkedNa(selectedRecord, true),
                      })
                    }}
                  >
                    NA
                  </Button>
                )}
                {!markedNaSupported ? (
                  <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                    NA requires database/CLIENT_PAYMENT_MARKED_NA.sql in Supabase.
                  </Text>
                ) : null}
              </div>
            )}
            {isOpenList && canEditRaisedInvoiceCore && (
              <Button type="default" icon={<EditOutlined />} onClick={openEditInvoiceModal} style={{ marginTop: 12 }}>
                Edit
              </Button>
            )}
            {isOpenList && !canEditRaisedInvoiceCore && !isCompleted && (
              <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
                Company and invoice fields can be edited within {CLIENT_PAYMENT_EDIT_DAYS} days of Timestamp (record creation).
              </Text>
            )}
            {isCompleted && (
              <>
                <Divider>Payment Received Details</Divider>
                {drawerStatusLoading ? (
                  <div style={{ padding: 8, color: '#888' }}>Loading…</div>
                ) : paymentReceiveSubmitted || selectedRecord.payment_received_date ? (
                  <div style={{ marginBottom: 16 }}>
                    <Space style={{ marginBottom: 8 }}>
                      <CheckCircleOutlined style={{ color: '#52c41a' }} />
                      <span>Payment Received</span>
                    </Space>
                    <Descriptions column={1} size="small" bordered>
                      <Descriptions.Item label="Party Name">{paymentReceiveDetails?.party_name || selectedRecord.company_name || '—'}</Descriptions.Item>
                      <Descriptions.Item label="Invoice Number">
                        {paymentReceiveDetails?.invoice_number || selectedRecord.invoice_number || '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label="Amount">
                        {paymentReceiveDetails?.amount != null && paymentReceiveDetails.amount !== ''
                          ? String(paymentReceiveDetails.amount)
                          : selectedRecord.invoice_amount || '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label="Date of Payment">
                        {paymentReceiveDetails?.payment_date
                          ? dayjs(paymentReceiveDetails.payment_date).format('DD-MMM-YYYY')
                          : selectedRecord.payment_received_date
                            ? dayjs(selectedRecord.payment_received_date).format('DD-MMM-YYYY')
                            : '—'}
                      </Descriptions.Item>
                      {paymentReceiveCreatedAt && (
                        <Descriptions.Item label="Submitted at">
                          {dayjs(paymentReceiveCreatedAt).format('DD-MMM-YYYY HH:mm')}
                        </Descriptions.Item>
                      )}
                    </Descriptions>
                  </div>
                ) : (
                  <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                    No payment receive details on file.
                  </Text>
                )}
              </>
            )}
            <Divider>Invoice Sent details & Follow up</Divider>
            {drawerStatusLoading ? (
              <div style={{ padding: 8, color: '#888' }}>Loading…</div>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {sentSubmitted ? (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      <Space>
                        <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        <span>Invoice Sent details</span>
                      </Space>
                      {sentEditable ? (
                        <Button type="link" size="small" icon={<EditOutlined />} onClick={openSentDetails}>
                          Edit
                        </Button>
                      ) : (
                        <Button type="link" size="small" onClick={openSentDetails}>View</Button>
                      )}
                    </div>
                    <Descriptions column={1} size="small" bordered>
                      <Descriptions.Item label="Email Sent">{sentSummary ? (sentSummary.email_sent ? 'Yes' : 'No') : '—'}</Descriptions.Item>
                      <Descriptions.Item label="Courier Sent">{sentSummary ? (sentSummary.courier_sent ? 'Yes' : 'No') : '—'}</Descriptions.Item>
                      <Descriptions.Item label="WhatsApp Sent">{sentSummary ? (sentSummary.whatsapp_sent ? 'Yes' : 'No') : '—'}</Descriptions.Item>
                      <Descriptions.Item label="Email">{sentDetails?.email || '—'}</Descriptions.Item>
                      <Descriptions.Item label="Tracking details">{sentDetails?.tracking_details || '—'}</Descriptions.Item>
                      <Descriptions.Item label="WhatsApp Number">{sentDetails?.whatsapp_number || '—'}</Descriptions.Item>
                    </Descriptions>
                  </div>
                ) : (
                  <Button type="primary" block icon={<FormOutlined />} onClick={openSentDetails} size="large">
                    Invoice Sent details
                  </Button>
                )}
                {sentSubmitted && !isCompleted && (
                  <Button type="primary" block icon={<FormOutlined />} onClick={openPaymRec} size="large" style={{ marginBottom: 16 }}>
                    Paym-Rec
                  </Button>
                )}
                {sentSubmitted && !isCompleted && followupsItems.map((fu) => (
                  <div key={fu.followup_no} style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      <Space>
                        <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        <span>Follow up {fu.followup_no}</span>
                      </Space>
                      {fu.editable_24h ? (
                        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openFollowup(fu.followup_no)}>
                          Edit
                        </Button>
                      ) : (
                        <Button type="link" size="small" onClick={() => openFollowup(fu.followup_no)}>
                          View
                        </Button>
                      )}
                    </div>
                    <Descriptions column={1} size="small" bordered>
                      <Descriptions.Item label="Contact Person">{fu.contact_person || '—'}</Descriptions.Item>
                      <Descriptions.Item label="Timestamp">
                        {fu.followup_timestamp ? dayjs(fu.followup_timestamp).format('DD-MMM-YYYY hh:mm A') : '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label="Mail Sent">{fu.mail_sent ? 'Yes' : 'No'}</Descriptions.Item>
                      <Descriptions.Item label="WhatsApp Sent">{fu.whatsapp_sent ? 'Yes' : 'No'}</Descriptions.Item>
                      <Descriptions.Item label="Remarks">{fu.remarks || '—'}</Descriptions.Item>
                    </Descriptions>
                  </div>
                ))}
                {sentSubmitted && !isCompleted && nextFollowupNo <= 10 && (
                  <Button type="primary" block icon={<FormOutlined />} onClick={() => openFollowup(nextFollowupNo)} size="large" style={{ marginBottom: 16 }}>
                    Follow up {nextFollowupNo}
                  </Button>
                )}
                {sentSubmitted && !isCompleted && (nextFollowupNo > 3 || showInterceptByDate) && (
                  <>
                    {interceptSubmitted ? (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <Space><CheckCircleOutlined style={{ color: '#52c41a' }} /><span>Intercept Requirements</span></Space>
                          <Space size={8}>
                            {!interceptHasTaggedUser && (
                              <Button size="small" onClick={openInterceptTag}>
                                Tag
                              </Button>
                            )}
                            {interceptEditable ? (
                              <Button type="link" size="small" icon={<EditOutlined />} onClick={openIntercept}>Edit</Button>
                            ) : (
                              <Button type="link" size="small" onClick={openIntercept}>View</Button>
                            )}
                          </Space>
                        </div>
                        <Descriptions column={1} size="small" bordered>
                          <Descriptions.Item label="Last Remark of User">{interceptDetails?.last_remark_user || '—'}</Descriptions.Item>
                          <Descriptions.Item label="Usage Details (Last 1 Month)">{interceptDetails?.usage_last_1_month || '—'}</Descriptions.Item>
                          <Descriptions.Item label="Contact Person">{interceptDetails?.contact_person || '—'}</Descriptions.Item>
                          <Descriptions.Item label="Contact Number">{interceptDetails?.contact_number || '—'}</Descriptions.Item>
                          <Descriptions.Item label="Tag">{interceptDetails?.tagged_user_name || interceptDetails?.tagged_user_email || '—'}</Descriptions.Item>
                        </Descriptions>
                      </div>
                    ) : (
                      <Button type="default" block icon={<FormOutlined />} onClick={openIntercept} size="large" style={{ marginBottom: 16 }}>Intercept Requirements</Button>
                    )}
                    {interceptSubmitted &&
                      !!(interceptDetails?.tagged_user_id || interceptDetails?.tagged_user_name || interceptDetails?.tagged_user_email) && (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                            <Space>
                              <CheckCircleOutlined style={{ color: '#52c41a' }} />
                              <span>Payment action</span>
                            </Space>
                            {showClientPaymentT2Button && (
                              <Tooltip title="Assign a second user (after first payment action)">
                                <Button size="small" type="default" onClick={openInterceptTag2}>
                                  T 2
                                </Button>
                              </Tooltip>
                            )}
                          </div>
                          <Descriptions column={1} size="small" bordered>
                            <Descriptions.Item label="Tag (user)">
                              {interceptDetails?.tagged_user_name || interceptDetails?.tagged_user_email || '—'}
                            </Descriptions.Item>
                            <Descriptions.Item label="Person">{interceptDetails?.payment_action_person || '—'}</Descriptions.Item>
                            <Descriptions.Item label="Remarks">{interceptDetails?.payment_action_remarks || '—'}</Descriptions.Item>
                            {!interceptDetails?.payment_action_submitted_at && (
                              <Descriptions.Item label=" ">
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  Person &amp; Remarks appear here after someone submits <b>Payment Action</b> on the Support Dashboard (Master Admin or the tagged user).
                                </Text>
                              </Descriptions.Item>
                            )}
                            {(interceptDetails?.tagged_user_2_name || interceptDetails?.tagged_user_2_email) && (
                              <Descriptions.Item label="Tag 2 (user)">
                                {interceptDetails?.tagged_user_2_name || interceptDetails?.tagged_user_2_email || '—'}
                              </Descriptions.Item>
                            )}
                            {interceptHasTaggedUser2 && (
                              <>
                                <Descriptions.Item label="Person (T2)">
                                  {interceptDetails?.payment_action_2_person || '—'}
                                </Descriptions.Item>
                                <Descriptions.Item label="Remarks (T2)">
                                  {interceptDetails?.payment_action_2_remarks || '—'}
                                </Descriptions.Item>
                                <Descriptions.Item label="Submitted (T2)">
                                  {interceptDetails?.payment_action_2_submitted_at
                                    ? dayjs(interceptDetails.payment_action_2_submitted_at).format('DD-MMM-YYYY HH:mm')
                                    : '—'}
                                </Descriptions.Item>
                              </>
                            )}
                          </Descriptions>
                        </div>
                      )}
                  </>
                )}
                {sentSubmitted && !isCompleted && (nextFollowupNo > 3 || showDiscontinuationByDate) && (
                  discontinuationSubmitted ? (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <Space><CheckCircleOutlined style={{ color: '#52c41a' }} /><span>Discontinuation Mail</span></Space>
                        <Button type="link" size="small" onClick={openDiscontinuation}>View</Button>
                      </div>
                      <Descriptions column={1} size="small" bordered>
                        <Descriptions.Item label="Mail Sent To">{discontinuationDetails?.mail_sent_to || '—'}</Descriptions.Item>
                        <Descriptions.Item label="Mail Sent On">{discontinuationDetails?.mail_sent_on ? dayjs(discontinuationDetails.mail_sent_on).format('DD-MMM-YYYY') : '—'}</Descriptions.Item>
                        <Descriptions.Item label="Remarks">{discontinuationDetails?.remarks || '—'}</Descriptions.Item>
                      </Descriptions>
                    </div>
                  ) : (
                    <Button type="default" block icon={<FormOutlined />} onClick={openDiscontinuation} size="large" style={{ marginBottom: 16 }}>Discontinuation Mail</Button>
                  )
                )}
              </Space>
            )}
          </>
        )}
      </Drawer>

      <Modal
        title="Export"
        open={exportOpen}
        onCancel={() => setExportOpen(false)}
        onOk={handleExport}
        okText="Export"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text type="secondary">Select columns to include in export.</Text>
          <Checkbox.Group
            style={{ width: '100%' }}
            value={selectedExportColumns}
            options={exportOptions}
            onChange={(vals) => setSelectedExportColumns(vals as string[])}
          />
        </Space>
      </Modal>

      <Modal
        title="Invoice Sent details"
        open={sentModalOpen}
        onCancel={() => setSentModalOpen(false)}
        footer={null}
        destroyOnClose
        width={640}
      >
        <Form
          form={sentForm}
          layout="vertical"
          style={{ marginTop: 16 }}
          disabled={!sentEditable}
          onFinish={handleSentSubmit}
        >
          <Form.Item
            name="email_sent"
            label="Email Sent"
            initialValue={false}
            rules={[{ required: true, message: 'Please select Email Sent' }]}
          >
            <Select
              options={[
                { label: 'No', value: false },
                { label: 'Yes', value: true },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.email_sent !== curr.email_sent}>
            {({ getFieldValue }) =>
              getFieldValue('email_sent') ? (
                <Form.Item
                  name="email"
                  label="Email"
                  rules={[
                    {
                      validator(_, value) {
                        const t = String(value || '').trim()
                        if (!t) return Promise.resolve()
                        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                        if (!re.test(t)) return Promise.reject(new Error('Enter a valid email'))
                        return Promise.resolve()
                      },
                    },
                  ]}
                >
                  <Input placeholder="name@example.com" />
                </Form.Item>
              ) : null
            }
          </Form.Item>

          <Form.Item
            name="courier_sent"
            label="Courier Sent"
            initialValue={false}
            rules={[{ required: true, message: 'Please select Courier Sent' }]}
          >
            <Select
              options={[
                { label: 'No', value: false },
                { label: 'Yes', value: true },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.courier_sent !== curr.courier_sent}>
            {({ getFieldValue }) =>
              getFieldValue('courier_sent') ? (
                <Form.Item
                  name="tracking_details"
                  label="Tracking details"
                  rules={[
                    {
                      validator(_, value) {
                        const t = String(value || '').trim()
                        if (!t) return Promise.resolve()
                        if (!/^[0-9A-Za-z-]+$/.test(t)) {
                          return Promise.reject(new Error('Use only numbers/letters/-'))
                        }
                        return Promise.resolve()
                      },
                    },
                  ]}
                >
                  <Input placeholder="Tracking number" />
                </Form.Item>
              ) : null
            }
          </Form.Item>

          <Form.Item
            name="whatsapp_sent"
            label="WhatsApp Sent"
            initialValue={false}
            rules={[{ required: true, message: 'Please select WhatsApp Sent' }]}
          >
            <Select
              options={[
                { label: 'No', value: false },
                { label: 'Yes', value: true },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.whatsapp_sent !== curr.whatsapp_sent}>
            {({ getFieldValue }) =>
              getFieldValue('whatsapp_sent') ? (
                <Form.Item
                  name="whatsapp_number"
                  label="WhatsApp Number"
                  rules={[
                    {
                      validator(_, value) {
                        const s = String(value || '').trim()
                        if (!s) return Promise.resolve()
                        if (!/^\d{10}$/.test(s)) return Promise.reject(new Error('Must be exactly 10 digits'))
                        return Promise.resolve()
                      },
                    },
                  ]}
                >
                  <Input maxLength={10} placeholder="10 digit number" />
                </Form.Item>
              ) : null
            }
          </Form.Item>

          <Form.Item
            name="invoice_number"
            label="Invoice Number"
          >
            <Input placeholder="Digits only" disabled />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={sentLoading} disabled={!sentEditable}>
                Save
              </Button>
              <Button onClick={() => setSentModalOpen(false)}>Cancel</Button>
            </Space>
          </Form.Item>
        </Form>

        <Divider orientation="left">Follow up 1 to 10</Divider>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Follow ups load from the same data as the drawer. After a follow up is saved, it is read-only here; within {CLIENT_PAYMENT_EDIT_DAYS} days of submission you can still use <b>Edit</b> on the drawer for that follow up.
        </Text>
        {!sentSubmitted ? (
          <Text type="warning" style={{ display: 'block', marginBottom: 12 }}>
            Save Invoice Sent details above first — then Follow up 1 will unlock, then 2, and so on.
          </Text>
        ) : null}
        <div style={{ maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
              const fu = followupsItems.find((x) => x.followup_no === n)
              const isSaved = !!fu
              const isNextEditable =
                sentSubmitted && !isSaved && n === nextFollowupNo && nextFollowupNo <= 10
              const isFuture = sentSubmitted && !isSaved && n > nextFollowupNo && nextFollowupNo <= 10
              const beforeSent = !sentSubmitted

              return (
                <Card key={n} size="small" title={`Follow up ${n}`}>
                  {isSaved ? (
                    <Descriptions column={1} size="small" bordered>
                      <Descriptions.Item label="Contact Person">{fu.contact_person || '—'}</Descriptions.Item>
                      <Descriptions.Item label="Timestamp">
                        {fu.followup_timestamp ? dayjs(fu.followup_timestamp).format('DD-MMM-YYYY hh:mm A') : '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label="Remarks">{fu.remarks || '—'}</Descriptions.Item>
                      <Descriptions.Item label="Mail Sent">{fu.mail_sent ? 'Yes' : 'No'}</Descriptions.Item>
                      <Descriptions.Item label="WhatsApp Sent">{fu.whatsapp_sent ? 'Yes' : 'No'}</Descriptions.Item>
                    </Descriptions>
                  ) : null}
                  {isNextEditable ? (
                    <Form
                      key={`sent-inline-fu-${nextFollowupNo}`}
                      form={sentInlineFollowupForm}
                      layout="vertical"
                      style={{ marginTop: isSaved ? 12 : 0 }}
                      onFinish={handleSentModalInlineFollowupSave}
                    >
                      <Form.Item name="contact_person" label="Contact Person">
                        <Input placeholder="Enter contact person" />
                      </Form.Item>
                      <Form.Item
                        name="followup_timestamp"
                        label="Timestamp"
                        rules={[{ required: true, message: 'Timestamp is required' }]}
                      >
                        <DatePicker
                          showTime={{ format: 'hh:mm A', use12Hours: true }}
                          format="DD-MMM-YYYY hh:mm A"
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                      <Form.Item name="remarks" label="Remarks">
                        <Input.TextArea rows={3} placeholder="Enter remarks" />
                      </Form.Item>
                      <Form.Item name="mail_sent" label="Mail Sent" initialValue={false}>
                        <Select options={[{ label: 'No', value: false }, { label: 'Yes', value: true }]} />
                      </Form.Item>
                      <Form.Item name="whatsapp_sent" label="WhatsApp Sent" initialValue={false}>
                        <Select options={[{ label: 'No', value: false }, { label: 'Yes', value: true }]} />
                      </Form.Item>
                      <Form.Item style={{ marginBottom: 0 }}>
                        <Button type="primary" htmlType="submit" loading={followupLoading}>
                          Save follow up {n}
                        </Button>
                      </Form.Item>
                    </Form>
                  ) : null}
                  {beforeSent && !isSaved ? (
                    <Text type="secondary">Locked until Invoice Sent details are saved.</Text>
                  ) : null}
                  {!beforeSent && !isSaved && !isNextEditable && isFuture ? (
                    <Text type="secondary">Complete follow up {nextFollowupNo} first.</Text>
                  ) : null}
                  {!beforeSent && !isSaved && !isNextEditable && !isFuture && n <= 10 ? (
                    <Text type="secondary">—</Text>
                  ) : null}
                </Card>
              )
            })}
          </Space>
        </div>
      </Modal>

      <Modal
        title={`Follow up ${currentFollowupNo}`}
        open={followupModalOpen}
        onCancel={() => setFollowupModalOpen(false)}
        footer={null}
        destroyOnClose
        width={520}
      >
        <Form form={followupForm} layout="vertical" style={{ marginTop: 16 }} disabled={!followupEditable} onFinish={handleFollowupSubmit}>
          <Form.Item name="contact_person" label="Contact Person"><Input placeholder="Enter contact person" /></Form.Item>
          <Form.Item
            name="followup_timestamp"
            label="Timestamp"
            rules={[{ required: true, message: 'Timestamp is required' }]}
          >
            <DatePicker
              showTime={{ format: 'hh:mm A', use12Hours: true }}
              format="DD-MMM-YYYY hh:mm A"
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item name="remarks" label="Remarks"><Input.TextArea rows={3} placeholder="Enter remarks" /></Form.Item>
          <Form.Item name="mail_sent" label="Mail Sent" initialValue={false}><Select options={[{ label: 'No', value: false }, { label: 'Yes', value: true }]} /></Form.Item>
          <Form.Item name="whatsapp_sent" label="WhatsApp Sent" initialValue={false}><Select options={[{ label: 'No', value: false }, { label: 'Yes', value: true }]} /></Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={followupLoading} disabled={!followupEditable}>Save</Button>
              <Button onClick={() => setFollowupModalOpen(false)}>Cancel</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="Intercept Requirements" open={interceptModalOpen} onCancel={() => setInterceptModalOpen(false)} footer={null} destroyOnClose width={520}>
        <Form form={interceptForm} layout="vertical" style={{ marginTop: 16 }} onFinish={handleInterceptSubmit} disabled={!interceptEditable}>
          <Form.Item name="last_remark_user" label="Last Remark of User"><Input.TextArea rows={2} placeholder="Last remark of user" /></Form.Item>
          <Form.Item name="usage_last_1_month" label="Usage Details of Last 1 Month"><Input.TextArea rows={2} placeholder="Usage details" /></Form.Item>
          <Form.Item name="contact_person" label="Contact Person"><Input placeholder="Contact person" /></Form.Item>
          <Form.Item name="contact_number" label="Contact Number"><Input placeholder="Contact number" maxLength={15} /></Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
              {interceptEditable && <Button type="primary" htmlType="submit">Save</Button>}
              <Button onClick={() => setInterceptModalOpen(false)}>Cancel</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Tag user (Intercept Requirements)"
        open={interceptTagModalOpen}
        onCancel={() => setInterceptTagModalOpen(false)}
        onOk={saveInterceptTag}
        okText="Save"
        confirmLoading={tagLoading}
        destroyOnClose
        width={520}
      >
        <div style={{ marginTop: 12 }}>
          <Select
            showSearch
            placeholder="Select registered user"
            loading={tagLoading}
            value={tagSelectedUserId ?? undefined}
            onChange={(v) => setTagSelectedUserId(v)}
            options={tagUsers.map((u) => ({
              label: `${u.full_name || '(No name)'}${u.email ? ` — ${u.email}` : ''}`,
              value: u.id,
            }))}
            filterOption={(input, option) =>
              String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginTop: 12, color: '#666', fontSize: 12 }}>
          This will appear in Master Admin dashboard under <b>Payment Action</b>.
        </div>
      </Modal>

      <Modal
        title="Tag user (T 2)"
        open={interceptTag2ModalOpen}
        onCancel={() => setInterceptTag2ModalOpen(false)}
        onOk={saveInterceptTag2}
        okText="Save"
        okButtonProps={{ loading: tagLoading }}
        confirmLoading={tagLoading}
        destroyOnClose
        width={520}
      >
        <div style={{ marginTop: 12 }}>
          <Select
            showSearch
            placeholder="Select registered user"
            loading={tagLoading}
            value={tag2SelectedUserId ?? undefined}
            onChange={(v) => setTag2SelectedUserId(v)}
            options={tagUsers.map((u) => ({
              label: `${u.full_name || '(No name)'}${u.email ? ` — ${u.email}` : ''}`,
              value: u.id,
            }))}
            filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginTop: 12, color: '#666', fontSize: 12 }}>
          Available after the first payment action (Person / Remarks). Any logged-in user can assign Tag 2.
        </div>
      </Modal>

      <Modal title="Discontinuation Mail" open={discontinuationModalOpen} onCancel={() => setDiscontinuationModalOpen(false)} footer={null} destroyOnClose width={520}>
        <Form form={discontinuationForm} layout="vertical" style={{ marginTop: 16 }} onFinish={handleDiscontinuationSubmit}>
          <Form.Item name="mail_sent_to" label="Mail Sent To" rules={[{ required: true, message: 'Required' }]}><Input placeholder="Email or recipient" /></Form.Item>
          <Form.Item name="mail_sent_on" label="Mail Sent On (Date)" rules={[{ required: true, message: 'Required' }]}><DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" /></Form.Item>
          <Form.Item name="remarks" label="Remarks"><Input.TextArea rows={2} placeholder="Remarks" /></Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit">Save</Button>
              <Button onClick={() => setDiscontinuationModalOpen(false)}>Cancel</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="Payment Receive Details (Paym-Rec)" open={paymRecModalOpen} onCancel={() => setPaymRecModalOpen(false)} footer={null} destroyOnClose width={520}>
        <Form form={paymRecForm} layout="vertical" style={{ marginTop: 16 }} onFinish={handlePaymRecSubmit}>
          <Form.Item name="party_name" label="Party Name" rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="Auto from company name" disabled />
          </Form.Item>
          <Form.Item name="invoice_number" label="Invoice Number"><Input placeholder="Auto from invoice" disabled /></Form.Item>
          <Form.Item name="amount" label="Amount" rules={[{ required: true, message: 'Required' }]}><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
          <Form.Item name="payment_date" label="Date of Payment" rules={[{ required: true, message: 'Required' }]}><DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" /></Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit">Save</Button>
              <Button onClick={() => setPaymRecModalOpen(false)}>Cancel</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Edit Invoice"
        open={editInvoiceModalOpen}
        onCancel={() => {
          setEditInvoiceModalOpen(false)
          editInvoiceForm.resetFields()
        }}
        footer={null}
        destroyOnClose
        width={520}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          Changes are allowed for {CLIENT_PAYMENT_EDIT_DAYS} days after the original Timestamp, and only until payment is received.
        </Text>
        <Form form={editInvoiceForm} layout="vertical" style={{ marginTop: 8 }} onFinish={handleEditInvoiceSubmit}>
          <Form.Item
            name="company_name"
            label="Company Name"
            rules={[{ required: true, message: 'Company Name is required' }]}
          >
            <Select
              showSearch
              loading={companiesLoading}
              placeholder={companiesLoading ? 'Loading companies…' : 'Select company'}
              options={companies.map((c) => ({ label: c.name, value: c.name }))}
              filterOption={(input, option) =>
                (option?.label as string).toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>

          <Form.Item name="invoice_date" label="Invoice Date" rules={[{ required: true, message: 'Invoice Date is required' }]}>
            <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
          </Form.Item>

          <Form.Item
            name="invoice_amount"
            label="Invoice Amount"
            rules={[
              { required: true, message: 'Invoice Amount is required' },
              {
                validator: (_, value) => {
                  if (value === undefined || value === null || value === '') return Promise.resolve()
                  const s = String(value).trim()
                  if (!/^\d+$/.test(s)) return Promise.reject(new Error('Amount must be digits only'))
                  if (s.length > 11) return Promise.reject(new Error('Max 11 digits allowed'))
                  return Promise.resolve()
                },
              },
            ]}
          >
            <InputNumber style={{ width: '100%' }} maxLength={11} />
          </Form.Item>

          <Form.Item
            name="invoice_number"
            label="Invoice Number"
            rules={[
              { required: true, message: 'Invoice Number is required' },
              { max: 50, message: 'Max 50 characters allowed' },
            ]}
          >
            <Input maxLength={50} placeholder="Invoice number (alphanumeric / special characters allowed)" />
          </Form.Item>

          <Form.Item
            name="genre"
            label="Genre"
            rules={[{ required: true, message: 'Genre is required' }]}
          >
            <Select placeholder="Select frequency" options={GENRE_OPTIONS} />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={editInvoiceSubmitLoading}>
                Save
              </Button>
              <Button
                onClick={() => {
                  setEditInvoiceModalOpen(false)
                  editInvoiceForm.resetFields()
                }}
              >
                Cancel
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Add Invoice"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        destroyOnClose
        width={520}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }} onFinish={handleSubmit}>
          <Form.Item
            name="company_name"
            label="Company Name"
            rules={[{ required: true, message: 'Company Name is required' }]}
          >
            <Select
              showSearch
              loading={companiesLoading}
              placeholder={companiesLoading ? 'Loading companies…' : 'Select company'}
              options={companies.map((c) => ({ label: c.name, value: c.name }))}
              filterOption={(input, option) =>
                (option?.label as string).toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>

          <Form.Item name="invoice_date" label="Invoice Date" rules={[{ required: true, message: 'Invoice Date is required' }]}>
            <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
          </Form.Item>

          <Form.Item
            name="invoice_amount"
            label="Invoice Amount"
            rules={[
              { required: true, message: 'Invoice Amount is required' },
              {
                validator: (_, value) => {
                  if (value === undefined || value === null || value === '') return Promise.resolve()
                  const s = String(value).trim()
                  if (!/^\d+$/.test(s)) return Promise.reject(new Error('Amount must be digits only'))
                  if (s.length > 11) return Promise.reject(new Error('Max 11 digits allowed'))
                  return Promise.resolve()
                },
              },
            ]}
          >
            <InputNumber style={{ width: '100%' }} maxLength={11} />
          </Form.Item>

          <Form.Item
            name="invoice_number"
            label="Invoice Number"
            rules={[
              { required: true, message: 'Invoice Number is required' },
              { max: 50, message: 'Max 50 characters allowed' },
            ]}
          >
            <Input maxLength={50} placeholder="Invoice number (alphanumeric / special characters allowed)" />
          </Form.Item>

          <Form.Item
            name="genre"
            label="Genre"
            rules={[{ required: true, message: 'Genre is required' }]}
          >
            <Select placeholder="Select frequency" options={GENRE_OPTIONS} />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={submitLoading}>
                Save
              </Button>
              <Button onClick={() => setModalOpen(false)}>Cancel</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default ClientPaymentPage

