import { useState, useEffect } from 'react'
import {
  Drawer,
  Descriptions,
  Tag,
  Typography,
  Input,
  Button,
  Select,
  Space,
  message,
  Modal,
  Divider,
  DatePicker,
} from 'antd'
import { RocketOutlined, EditOutlined, CheckOutlined, CloseOutlined, RetweetOutlined } from '@ant-design/icons'
import { ticketsApi, type Stage2Remark } from '../../api/tickets'
import { formatDateTable, formatReplySla, formatDelay, stagingDelaySeconds } from '../../utils/helpers'
import type { Ticket } from '../../api/tickets'
import { useAuth } from '../../hooks/useAuth'
import { useRole } from '../../hooks/useRole'
import { supportApi, type Company, type Division, type Page } from '../../api/support'
import dayjs from 'dayjs'
import { formatPriorityLabel, getPriorityTagColor } from '../../utils/ticketPriority'
import { invalidateAfterStage2Remark } from '../../utils/sessionApiCache'
import { notifyStage2RemarkAdded } from '../../utils/stage2RemarkEvents'
import { RepeatedTicketsModal } from './RepeatedTicketsModal'
import { PriorityColoredReference } from './PriorityColoredReference'

const { TextArea } = Input
const { Text } = Typography

const SLA_2_HOUR = 2 * 3600
const SLA_1_DAY = 24 * 3600

/** Chores & Bugs ticket drawer “Edit” (100h window) — only these logins */
const SUPPORT_TICKET_EDIT_ALLOWED_EMAILS = new Set(['aman@industryprime.com', 'rimpa@industryprime.com'])

interface ChoresBugsDetailDrawerProps {
  ticketId: string | null
  /** Row from list — instant drawer paint while full GET refreshes in background */
  initialTicket?: Ticket | null
  open: boolean
  onClose: () => void
  onUpdate?: () => void
  readOnly?: boolean
}

const getSlaColor = (seconds: number, limitSeconds: number) => {
  if (seconds <= limitSeconds) return 'green'
  if (seconds <= limitSeconds * 1.2) return 'gold'
  return 'red'
}

function unwrapTicketResponse(res: unknown): Ticket | null {
  if (res && typeof res === 'object' && 'data' in res && res.data && typeof res.data === 'object' && 'id' in res.data) {
    return res.data as Ticket
  }
  if (res && typeof res === 'object' && 'id' in res) return res as Ticket
  return null
}

export const ChoresBugsDetailDrawer = ({
  ticketId,
  initialTicket,
  open,
  onClose,
  onUpdate,
  readOnly = false,
}: ChoresBugsDetailDrawerProps) => {
  const { user } = useAuth()
  const { isMasterAdmin } = useRole()
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [solutionModalOpen, setSolutionModalOpen] = useState(false)
  const [solutionText, setSolutionText] = useState('')
  const [markingStaging, setMarkingStaging] = useState(false)
  const [stage2Remarks, setStage2Remarks] = useState<Stage2Remark[]>([])
  const [newRemarkText, setNewRemarkText] = useState('')
  const [addingRemark, setAddingRemark] = useState(false)
  const [editingRemarkId, setEditingRemarkId] = useState<string | null>(null)
  const [editingRemarkText, setEditingRemarkText] = useState('')
  const [updatingRemark, setUpdatingRemark] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [repeatedOpen, setRepeatedOpen] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [pages, setPages] = useState<Page[]>([])
  const [divisions, setDivisions] = useState<Division[]>([])
  const [editForm, setEditForm] = useState<{
    title: string
    description: string
    company_id: string
    page_id: string
    division_id: string
    division_other: string
    user_name: string
    communicated_through: string
    submitted_by: string
    quality_of_response: string
    customer_questions: string
    query_arrival_at: string
    query_response_at: string
  }>({
    title: '',
    description: '',
    company_id: '',
    page_id: '',
    division_id: '',
    division_other: '',
    user_name: '',
    communicated_through: '',
    submitted_by: '',
    quality_of_response: '',
    customer_questions: '',
    query_arrival_at: '',
    query_response_at: '',
  })

  const isLevel3 = user?.role === 'user'
  const level3Restricted = isLevel3 && !isMasterAdmin && ticket?.level3_used_by_current_user === true
  useEffect(() => {
    if (open && ticketId) {
      const hasInitial = initialTicket?.id === ticketId
      if (hasInitial) {
        setTicket(initialTicket)
        setLoading(false)
      } else {
        setTicket(null)
        setLoading(true)
      }

      ticketsApi
        .get(ticketId)
        .then((res) => {
          const t = unwrapTicketResponse(res)
          if (t) setTicket(t)
        })
        .catch(() => {
          if (!hasInitial) message.error('Failed to load ticket')
        })
        .finally(() => setLoading(false))

      ticketsApi
        .getStage2Remarks(ticketId)
        .then((r) => setStage2Remarks((r?.data ?? []) as Stage2Remark[]))
        .catch(() => setStage2Remarks([]))
    } else {
      setTicket(null)
      setStage2Remarks([])
      setEditingRemarkId(null)
      setDivisions([])
      setCompanies([])
      setPages([])
    }
  }, [open, ticketId, initialTicket])

  const handleUpdate = async (updates: Partial<Ticket>) => {
    if (!ticketId) return
    setSaving(true)
    try {
      await ticketsApi.update(ticketId, updates)
      const res = await ticketsApi.get(ticketId)
      const t = res && typeof res === 'object' && 'data' in res && res.data && typeof res.data === 'object' && 'id' in res.data
        ? (res.data as Ticket)
        : res && typeof res === 'object' && 'id' in res ? (res as Ticket) : null
      setTicket(t)
      onUpdate?.()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string | string[] } } }
      const detail = err?.response?.data?.detail
      const msg = Array.isArray(detail) ? detail[0] : typeof detail === 'string' ? detail : 'Failed to update'
      message.error(msg || 'Failed to update. Run database/RUN_IN_SUPABASE.sql Part 3 in Supabase.')
    } finally {
      setSaving(false)
    }
  }

  const loadRemarks = () => {
    if (ticketId) {
      ticketsApi.getStage2Remarks(ticketId).then((r) => setStage2Remarks((r?.data ?? []) as Stage2Remark[])).catch(() => {})
    }
  }

  const handleAddRemark = async () => {
    if (!ticketId || !newRemarkText.trim()) return
    setAddingRemark(true)
    try {
      await ticketsApi.addStage2Remark(ticketId, newRemarkText.trim())
      setNewRemarkText('')
      loadRemarks()
      onUpdate?.()
      invalidateAfterStage2Remark()
      notifyStage2RemarkAdded()
      message.success('Remark added')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail || 'Failed to add remark')
    } finally {
      setAddingRemark(false)
    }
  }

  const handleUpdateRemark = async (remarkId: string) => {
    if (!ticketId || !editingRemarkText.trim()) return
    setUpdatingRemark(true)
    try {
      await ticketsApi.updateStage2Remark(ticketId, remarkId, editingRemarkText.trim())
      setEditingRemarkId(null)
      setEditingRemarkText('')
      loadRemarks()
      onUpdate?.()
      message.success('Remark updated')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail || 'Failed to update remark')
    } finally {
      setUpdatingRemark(false)
    }
  }

  const canEditRemark = (r: Stage2Remark) => isMasterAdmin || r.added_by === user?.id

  const emailLower = (user?.email || '').trim().toLowerCase()
  const canEditSupportTicketByEmail = SUPPORT_TICKET_EDIT_ALLOWED_EMAILS.has(emailLower)

  const createdAtMs = ticket?.created_at ? new Date(ticket.created_at).getTime() : 0
  const editWindowMs = 100 * 60 * 60 * 1000
  const canEditWithinWindow = !!createdAtMs && (Date.now() - createdAtMs) <= editWindowMs
  const canEditSupportTicket = !readOnly && canEditSupportTicketByEmail && canEditWithinWindow

  const ensureEditLookups = () => {
    const emailOk = SUPPORT_TICKET_EDIT_ALLOWED_EMAILS.has((user?.email || '').trim().toLowerCase())
    if (!emailOk) return
    if (companies.length === 0) {
      supportApi.getCompanies().then((rows) => setCompanies(rows || [])).catch(() => setCompanies([]))
    }
    if (pages.length === 0) {
      supportApi.getPages().then((rows) => setPages(rows || [])).catch(() => setPages([]))
    }
  }

  const openEditModal = () => {
    if (!ticket || !canEditSupportTicketByEmail) return
    ensureEditLookups()
    const nextCompanyId = ticket.company_id || ''
    setEditForm({
      title: ticket.title || '',
      description: ticket.description || '',
      company_id: nextCompanyId,
      page_id: ticket.page_id || '',
      division_id: ticket.division_id || '',
      division_other: ticket.division_other || '',
      user_name: ticket.user_name || '',
      communicated_through: ticket.communicated_through || '',
      submitted_by: ticket.submitted_by || '',
      quality_of_response: ticket.quality_of_response || '',
      customer_questions: ticket.customer_questions || '',
      query_arrival_at: ticket.query_arrival_at || '',
      query_response_at: ticket.query_response_at || '',
    })
    if (nextCompanyId) {
      supportApi.getDivisions(nextCompanyId, { bustCache: true }).then((rows) => setDivisions(rows || [])).catch(() => setDivisions([]))
    } else {
      setDivisions([])
    }
    setEditModalOpen(true)
  }

  const submitEditTicket = async () => {
    if (!ticketId || !canEditSupportTicket) return
    if (!editForm.title.trim()) {
      message.error('Title is required')
      return
    }
    if (!editForm.user_name.trim()) {
      message.error('User Name is required')
      return
    }
    if (!editForm.company_id) {
      message.error('Company is required')
      return
    }
    if (!editForm.page_id) {
      message.error('Page is required')
      return
    }
    if (!editForm.division_id) {
      message.error('Division is required')
      return
    }
    if (!editForm.quality_of_response.trim()) {
      message.error('Quality of Response is required')
      return
    }
    if (!editForm.customer_questions.trim()) {
      message.error('Customer Questions is required')
      return
    }
    if (!editForm.query_arrival_at) {
      message.error('Query Arrival Date & Time is required')
      return
    }
    if (!editForm.query_response_at) {
      message.error('Query Response Date & Time is required')
      return
    }

    setEditSubmitting(true)
    try {
      await ticketsApi.update(ticketId, {
        title: editForm.title.trim(),
        description: editForm.description.trim() || undefined,
        company_id: editForm.company_id,
        page_id: editForm.page_id,
        division_id: editForm.division_id,
        division_other: editForm.division_other.trim() || undefined,
        user_name: editForm.user_name.trim(),
        communicated_through: editForm.communicated_through || undefined,
        submitted_by: editForm.submitted_by.trim() || undefined,
        quality_of_response: editForm.quality_of_response.trim(),
        customer_questions: editForm.customer_questions.trim(),
        query_arrival_at: editForm.query_arrival_at,
        query_response_at: editForm.query_response_at,
      })
      const res = await ticketsApi.get(ticketId)
      const t = res && typeof res === 'object' && 'data' in res && res.data && typeof res.data === 'object' && 'id' in res.data
        ? (res.data as Ticket)
        : res && typeof res === 'object' && 'id' in res ? (res as Ticket) : null
      setTicket(t)
      setEditModalOpen(false)
      onUpdate?.()
      message.success('Ticket updated')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string | string[] } } }
      const detail = err?.response?.data?.detail
      const msg = Array.isArray(detail) ? detail[0] : typeof detail === 'string' ? detail : 'Failed to update ticket'
      message.error(msg)
    } finally {
      setEditSubmitting(false)
    }
  }

  const handleSubmitSolution = async () => {
    if (!ticketId || !solutionText.trim()) {
      message.error('Quality of Solution is required')
      return
    }
    setSaving(true)
    try {
      await ticketsApi.submitQualitySolution(ticketId, solutionText.trim())
      const res = await ticketsApi.get(ticketId)
      const t = res && typeof res === 'object' && 'data' in res && res.data && typeof res.data === 'object' && 'id' in res.data
        ? (res.data as Ticket)
        : res && typeof res === 'object' && 'id' in res ? (res as Ticket) : null
      setTicket(t)
      setSolutionModalOpen(false)
      setSolutionText('')
      onUpdate?.()
      message.success('Solution submitted')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail || 'Failed to submit solution')
    } finally {
      setSaving(false)
    }
  }

  if (!ticket && !loading) return null

  const planned1 = ticket?.created_at ? new Date(ticket.created_at).getTime() : 0
  const actual1 = ticket?.actual_1 ? new Date(ticket.actual_1).getTime() : 0
  const planned2 = ticket?.planned_2 ? new Date(ticket.planned_2).getTime() : actual1 || planned1
  const actual2 = ticket?.actual_2 ? new Date(ticket.actual_2).getTime() : 0
  const planned3 = ticket?.planned_3 ? new Date(ticket.planned_3).getTime() : actual2 || planned2
  const actual3 = ticket?.actual_3 ? new Date(ticket.actual_3).getTime() : 0
  const planned4 =
    ticket?.status_3 === 'completed' && actual3
      ? actual3
      : ticket?.status_1 === 'yes' && actual1
        ? actual1
        : ticket?.planned_4
          ? new Date(ticket.planned_4).getTime()
          : 0
  const actual4 = ticket?.actual_4 ? new Date(ticket.actual_4).getTime() : 0
  const queryArrival = ticket?.query_arrival_at ? new Date(ticket.query_arrival_at).getTime() : 0

  const now = Date.now()
  const status1 = ticket?.status_1
  const status2 = ticket?.status_2
  const status3 = ticket?.status_3
  const status4 = ticket?.status_4

  // Stage 1 delay: if status_1 not selected, after 2h from planned_1; if status_1=no, exact delay
  const stage1DelaySec =
    !status1
      ? planned1 ? Math.max(0, Math.floor((now - planned1) / 1000) - SLA_2_HOUR) : 0
      : status1 === 'no' && actual1
        ? Math.max(0, Math.floor((actual1 - planned1) / 1000))
        : 0

  // Stage 2: SLA 1 day for Pending
  const stage2DelaySec =
    status2 === 'pending'
      ? planned2
        ? Math.max(0, Math.floor((now - planned2) / 1000) - SLA_1_DAY)
        : 0
      : status2 === 'completed' && actual2 && planned2
        ? Math.max(0, Math.floor((actual2 - planned2) / 1000))
        : 0

  // Stage 3: SLA 2 hours
  const stage3DelaySec =
    status3 === 'pending'
      ? planned3
        ? Math.max(0, Math.floor((now - planned3) / 1000) - SLA_2_HOUR)
        : 0
      : status3 === 'completed' && actual3 && planned3
        ? Math.max(0, Math.floor((actual3 - planned3) / 1000))
        : 0

  // Stage 4: SLA 2 hours
  const stage4DelaySec =
    status4 === 'pending' && planned4
      ? Math.max(0, Math.floor((now - planned4) / 1000) - SLA_2_HOUR)
      : status4 === 'completed' && actual4 && planned4
        ? Math.max(0, Math.floor((actual4 - planned4) / 1000))
        : 0

  const showStage2 = status1 === 'no'
  const showStage3 = status2 === 'completed'
  const showStage4 = status3 === 'completed' || status1 === 'yes' || status2 === 'rejected'
  const canSubmitSolution = status4 === 'completed' && !ticket?.quality_solution
  const hasQualitySolution = !!ticket?.quality_solution
  // In Completed Chores & Bugs: only show Stage 1 & 2 for SLA; if ticket went through Staging, show staging stages too
  const completedViewOnlyTwoStages = readOnly
  const showStagingStages = readOnly && !!(ticket?.staging_planned)

  return (
    <>
      <Drawer
        title={ticket?.title || 'Chores & Bugs Details'}
        placement="right"
        width={640}
        open={open}
        onClose={onClose}
        loading={loading && !ticket}
        extra={
          ticket ? (
            <Button type="default" size="small" icon={<RetweetOutlined />} onClick={() => setRepeatedOpen(true)}>
              Repeated
            </Button>
          ) : null
        }
      >
        {ticket && (
          <>
            {/* BASE FIELDS (read-only) */}
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Reference No">
                <PriorityColoredReference referenceNo={ticket.reference_no} priority={ticket.priority} />
              </Descriptions.Item>
              <Descriptions.Item label="Timestamp">{formatDateTable(ticket.created_at)}</Descriptions.Item>
              <Descriptions.Item label="Title">{ticket.title || '-'}</Descriptions.Item>
              <Descriptions.Item label="Description">{ticket.description || '-'}</Descriptions.Item>
              <Descriptions.Item label="Attachment">
                {ticket.attachment_url &&
                (ticket.attachment_url.startsWith('http://') || ticket.attachment_url.startsWith('https://')) ? (
                  <a
                    href={ticket.attachment_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.preventDefault()
                      window.open(ticket.attachment_url!, '_blank', 'noopener,noreferrer')
                    }}
                  >
                    View
                  </a>
                ) : (
                  '-'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Priority">
                <Tag color={getPriorityTagColor(ticket.priority)}>{formatPriorityLabel(ticket.priority)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Type of Request">
                <Tag color={ticket.type === 'chore' ? 'green' : 'red'}>
                  {ticket.type === 'chore' ? 'Chores' : 'Bug'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Page">{ticket.page_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Company Name">{ticket.company_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="User Name">{ticket.user_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Division">{ticket.division_name || '-'}</Descriptions.Item>
              {ticket.division_name === 'Other' && (
                <Descriptions.Item label="Other Division">{ticket.division_other || '-'}</Descriptions.Item>
              )}
              <Descriptions.Item label="CT">{ticket.communicated_through || '-'}</Descriptions.Item>
              <Descriptions.Item label="Submitted By">{ticket.submitted_by || '-'}</Descriptions.Item>
              <Descriptions.Item label="Query Arrival Date & Time">
                {formatDateTable(ticket.query_arrival_at)}
              </Descriptions.Item>
              <Descriptions.Item label="Quality of Response">{ticket.quality_of_response || '-'}</Descriptions.Item>
              <Descriptions.Item label="Customer Questions">{ticket.customer_questions || '-'}</Descriptions.Item>
              <Descriptions.Item label="Query Response Date & Time">
                {formatDateTable(ticket.query_response_at)}
              </Descriptions.Item>
            </Descriptions>
            {!readOnly && canEditSupportTicketByEmail && (
              <div style={{ marginBottom: 16 }}>
                <Space direction="vertical" size={4}>
                  <Button
                    icon={<EditOutlined />}
                    onClick={openEditModal}
                    disabled={!canEditSupportTicket}
                  >
                    Edit
                  </Button>
                  {!canEditWithinWindow && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Edit is allowed only within 100 hours from ticket creation.
                    </Text>
                  )}
                </Space>
              </div>
            )}

            {!readOnly && !ticket.staging_planned && status1 === 'no' && (
              <div style={{ marginBottom: 16 }}>
                <Button
                  type="primary"
                  icon={<RocketOutlined />}
                  loading={markingStaging}
                  onClick={async () => {
                    if (!ticketId) return
                    setMarkingStaging(true)
                    try {
                      await ticketsApi.markStaging(ticketId)
                      message.success('Ticket moved to Staging')
                      onUpdate?.()
                      onClose()
                    } catch (e: unknown) {
                      const err = e as { response?: { data?: { detail?: string } } }
                      message.error(err?.response?.data?.detail || 'Failed to mark as Staging')
                    } finally {
                      setMarkingStaging(false)
                    }
                  }}
                >
                  Mark as Staging
                </Button>
              </div>
            )}

            {/* REPLY STATUS (30-min SLA) */}
            <div style={{ marginBottom: 16 }}>
              <Text strong>Reply Status (30-min SLA)</Text>
              <div style={{ marginTop: 4 }}>
                {(() => {
                  const sla = formatReplySla(ticket.query_arrival_at, ticket.query_response_at)
                  return (
                    <Tag color={sla.status === 'on-time' ? 'green' : 'red'}>{sla.text}</Tag>
                  )
                })()}
              </div>
            </div>

            <Divider />

            {/* STAGE 1 — FIRST ACTION */}
            <div style={{ marginBottom: 20, padding: 12, background: '#e6f7ff', borderRadius: 8 }}>
              <Text strong style={{ color: '#1890ff' }}>Stage 1 — First Action</Text>
              <div style={{ marginTop: 8 }}>
                <Text type="secondary">Planned 1: </Text>
                {formatDateTable(ticket.created_at)}
              </div>
              <Space style={{ marginTop: 8 }} wrap>
                <Text>Status 1:</Text>
                <Select
                  value={ticket.status_1 || undefined}
                  onChange={(v) => {
                    const nowIso = new Date().toISOString()
                    const updates: Partial<Ticket> = { status_1: v as 'yes' | 'no', actual_1: nowIso }
                    if (v === 'no') updates.planned_2 = nowIso
                    if (v === 'yes') updates.planned_4 = nowIso
                    handleUpdate(updates)
                  }}
                  style={{ width: 100 }}
                  placeholder="Select"
                  disabled={saving || readOnly}
                >
                  <Select.Option value="yes">Yes</Select.Option>
                  <Select.Option value="no">No</Select.Option>
                </Select>
              </Space>
              <div style={{ marginTop: 8 }}>
                <Text>Actual 1:</Text>
                <Text style={{ marginLeft: 8 }}>{formatDateTable(ticket.actual_1) || '-'}</Text>
              </div>
              {stage1DelaySec > 0 && (
                <div style={{ marginTop: 8 }}>
                  <Tag color={getSlaColor(stage1DelaySec, SLA_2_HOUR)}>
                    Time Delay: {formatDelay(stage1DelaySec)}
                  </Tag>
                </div>
              )}
            </div>

            {/* STAGE 2 — WORK PROGRESS (visible if Status 1 = No) */}
            {showStage2 && (
              <div style={{ marginBottom: 20, padding: 12, background: '#fff7e6', borderRadius: 8 }}>
                <Text strong style={{ color: '#fa8c16' }}>Stage 2 — Work Progress</Text>
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary">Planned 2: </Text>
                  {formatDateTable(ticket.actual_1 || ticket.planned_2)}
                </div>
                <Space style={{ marginTop: 8 }} wrap>
                  <Text>Status 2:</Text>
                  <Select
                    value={ticket.status_2 || undefined}
                    onChange={(v) => {
                      const nowIso = new Date().toISOString()
                      const updates: Partial<Ticket> = { status_2: v as Ticket['status_2'] }
                      if (ticket.actual_1) updates.planned_2 = ticket.actual_1
                      if (v === 'completed') {
                        updates.actual_2 = nowIso
                        updates.planned_3 = nowIso
                      }
                      if (v === 'hold') updates.actual_2 = nowIso
                      if (v === 'staging') {
                        updates.actual_2 = nowIso
                        updates.staging_planned = nowIso
                        updates.staging_review_actual = nowIso
                        updates.staging_review_status = 'pending'
                      }
                      if (v === 'rejected') {
                        updates.actual_2 = nowIso
                        updates.planned_4 = nowIso
                      }
                      if (v === 'na') updates.actual_2 = nowIso
                      handleUpdate(updates)
                    }}
                    style={{ width: 120 }}
                    placeholder="Select"
                    disabled={saving || readOnly}
                  >
                    <Select.Option value="completed">Completed</Select.Option>
                    <Select.Option value="pending">Pending</Select.Option>
                    <Select.Option value="staging">Staging</Select.Option>
                    <Select.Option value="hold">Hold</Select.Option>
                    <Select.Option value="na">NA</Select.Option>
                    <Select.Option value="rejected">Rejected</Select.Option>
                  </Select>
                </Space>
                <div style={{ marginTop: 8 }}>
                  <Text>{status2 === 'hold' ? 'Actual 2 (Hold):' : 'Actual 2:'}</Text>
                  <Text style={{ marginLeft: 8 }}>{formatDateTable(ticket.actual_2) || '-'}</Text>
                </div>
                {stage2DelaySec > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <Tag color={getSlaColor(stage2DelaySec, SLA_1_DAY)}>
                      Time Delay (SLA 1 Day): {formatDelay(stage2DelaySec)}
                    </Tag>
                  </div>
                )}
                {/* Remarks section - all users add/view; edit: Master Admin or author */}
                <div style={{ marginTop: 16 }}>
                  <Text strong>Remarks</Text>
                  <div style={{ marginTop: 8, maxHeight: 200, overflowY: 'auto' }}>
                    {stage2Remarks.length === 0 && (
                      <Text type="secondary" style={{ fontSize: 12 }}>No remarks yet</Text>
                    )}
                    {stage2Remarks.map((r) => (
                      <div
                        key={r.id}
                        style={{
                          marginBottom: 8,
                          padding: 8,
                          background: '#fafafa',
                          borderRadius: 6,
                          borderLeft: '3px solid #fa8c16',
                        }}
                      >
                        {editingRemarkId === r.id ? (
                          <div>
                            <TextArea
                              value={editingRemarkText}
                              onChange={(e) => setEditingRemarkText(e.target.value)}
                              rows={2}
                              style={{ marginBottom: 8 }}
                              disabled={updatingRemark}
                            />
                            <Space>
                              <Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => handleUpdateRemark(r.id)} loading={updatingRemark}>
                                Save
                              </Button>
                              <Button size="small" icon={<CloseOutlined />} onClick={() => { setEditingRemarkId(null); setEditingRemarkText('') }}>
                                Cancel
                              </Button>
                            </Space>
                          </div>
                        ) : (
                          <div>
                            <Text style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{r.remark_text}</Text>
                            <div style={{ marginTop: 4, fontSize: 11, color: '#8c8c8c' }}>
                              {r.added_by_name || 'Unknown'} · {formatDateTable(r.added_at)}
                              {canEditRemark(r) && !readOnly && (
                                <Button
                                  type="link"
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={() => { setEditingRemarkId(r.id); setEditingRemarkText(r.remark_text) }}
                                  style={{ padding: '0 4px', height: 'auto', fontSize: 11 }}
                                >
                                  Edit
                                </Button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {!readOnly && (
                    <div style={{ marginTop: 8 }}>
                      <TextArea
                        placeholder="Add a remark..."
                        value={newRemarkText}
                        onChange={(e) => setNewRemarkText(e.target.value)}
                        rows={2}
                        style={{ marginBottom: 6 }}
                        disabled={addingRemark || updatingRemark}
                      />
                      <Button type="primary" size="small" onClick={handleAddRemark} loading={addingRemark} disabled={!newRemarkText.trim()}>
                        Add Remark
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* STAGING WORKFLOW (read-only, only in Completed Chores & Bugs when ticket went through Staging) */}
            {showStagingStages && ticket && (
              <>
                <Divider>Staging Workflow</Divider>
                <div style={{ marginBottom: 20, padding: 12, background: '#e6f7ff', borderRadius: 8 }}>
                  <Text strong style={{ color: '#1890ff' }}>Stage 1: Staging Planned</Text>
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary">Staging Planned: </Text>
                    {formatDateTable(ticket.staging_planned)}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <Text>Staging Review Status: </Text>
                    <Tag>{ticket.staging_review_status || 'Pending'}</Tag>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <Text>Review Actual: </Text>
                    {formatDateTable(ticket.staging_review_actual) || '-'}
                  </div>
                  {stagingDelaySeconds(ticket.staging_planned, ticket.staging_review_status, ticket.staging_review_actual) > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <Tag color={stagingDelaySeconds(ticket.staging_planned, ticket.staging_review_status, ticket.staging_review_actual) > SLA_2_HOUR ? 'red' : 'gold'}>
                        Staging Delay: {formatDelay(stagingDelaySeconds(ticket.staging_planned, ticket.staging_review_status, ticket.staging_review_actual))}
                      </Tag>
                    </div>
                  )}
                </div>
                {ticket.staging_review_status === 'completed' && (
                  <div style={{ marginBottom: 20, padding: 12, background: '#f6ffed', borderRadius: 8 }}>
                    <Text strong style={{ color: '#52c41a' }}>Stage 2: Live Planned</Text>
                    <div style={{ marginTop: 8 }}>
                      <Text type="secondary">Live Planned: </Text>
                      {formatDateTable(ticket.live_planned || ticket.staging_review_actual)}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <Text>Live Status: </Text>
                      <Tag>{ticket.live_status || 'Pending'}</Tag>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <Text>Live Actual: </Text>
                      {formatDateTable(ticket.live_actual) || '-'}
                    </div>
                    {stagingDelaySeconds(ticket.live_planned, ticket.live_status, ticket.live_actual) > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <Tag color={stagingDelaySeconds(ticket.live_planned, ticket.live_status, ticket.live_actual) > SLA_2_HOUR ? 'red' : 'gold'}>
                          Delay in Push Live: {formatDelay(stagingDelaySeconds(ticket.live_planned, ticket.live_status, ticket.live_actual))}
                        </Tag>
                      </div>
                    )}
                  </div>
                )}
                {ticket.live_status === 'completed' && (
                  <div style={{ marginBottom: 20, padding: 12, background: '#fffbe6', borderRadius: 8 }}>
                    <Text strong style={{ color: '#faad14' }}>Stage 3: Review Planned</Text>
                    <div style={{ marginTop: 8 }}>
                      <Text type="secondary">Live Review Planned: </Text>
                      {formatDateTable(ticket.live_review_planned || ticket.live_actual)}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <Text>Live Review Status: </Text>
                      <Tag>{ticket.live_review_status || 'Pending'}</Tag>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <Text>Live Review Actual: </Text>
                      {formatDateTable(ticket.live_review_actual) || '-'}
                    </div>
                    {stagingDelaySeconds(ticket.live_review_planned, ticket.live_review_status, ticket.live_review_actual) > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <Tag color={stagingDelaySeconds(ticket.live_review_planned, ticket.live_review_status, ticket.live_review_actual) > SLA_2_HOUR ? 'red' : 'gold'}>
                          Live Delay in Review: {formatDelay(stagingDelaySeconds(ticket.live_review_planned, ticket.live_review_status, ticket.live_review_actual))}
                        </Tag>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* STAGE 3 — REVIEW TURNAROUND (visible if Status 2 = Completed; hidden in Completed Chores & Bugs read-only view) */}
            {showStage3 && !completedViewOnlyTwoStages && (
              <div style={{ marginBottom: 20, padding: 12, background: '#fffbe6', borderRadius: 8 }}>
                <Text strong style={{ color: '#faad14' }}>Stage 3 — Review Turnaround</Text>
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary">Planned 3: </Text>
                  {formatDateTable(ticket.actual_2 || ticket.planned_3)}
                </div>
                <Space style={{ marginTop: 8 }} wrap>
                  <Text>Status 3:</Text>
                  <Select
                    value={ticket.status_3 || undefined}
                    onChange={(v) => {
                      const nowIso = new Date().toISOString()
                      const updates: Partial<Ticket> = { status_3: v as Ticket['status_3'] }
                      if (ticket.actual_2) updates.planned_3 = ticket.actual_2
                      if (v === 'completed') {
                        updates.actual_3 = nowIso
                        updates.planned_4 = nowIso
                      }
                      if (v === 'hold') updates.actual_3 = nowIso
                      handleUpdate(updates)
                    }}
                    style={{ width: 120 }}
                    placeholder="Select"
                    disabled={saving || readOnly}
                  >
                    <Select.Option value="completed">Completed</Select.Option>
                    <Select.Option value="pending">Pending</Select.Option>
                    <Select.Option value="hold">Hold</Select.Option>
                    <Select.Option value="rejected">Rejected</Select.Option>
                    <Select.Option value="na">NA</Select.Option>
                  </Select>
                </Space>
                <div style={{ marginTop: 8 }}>
                  <Text>{status3 === 'hold' ? 'Actual 3 (Hold):' : 'Actual 3:'}</Text>
                  <Text style={{ marginLeft: 8 }}>{formatDateTable(ticket.actual_3) || '-'}</Text>
                </div>
                {stage3DelaySec > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <Tag color={getSlaColor(stage3DelaySec, SLA_2_HOUR)}>
                      Time Delay (SLA 2 hr): {formatDelay(stage3DelaySec)}
                    </Tag>
                  </div>
                )}
              </div>
            )}

            {/* STAGE 4 — CONFIRMATION (visible if Status 3 = Completed OR Status 1 = Yes; hidden in Completed Chores & Bugs read-only view) */}
            {showStage4 && !completedViewOnlyTwoStages && (
              <div style={{ marginBottom: 20, padding: 12, background: '#f6ffed', borderRadius: 8 }}>
                <Text strong style={{ color: '#52c41a' }}>Stage 4 — Confirmation</Text>
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary">Planned 4: </Text>
                  {formatDateTable(
                    status3 === 'completed' ? (ticket.actual_3 || ticket.planned_4) : status1 === 'yes' ? ticket.actual_1 : ticket.planned_4
                  )}
                </div>
                <Space style={{ marginTop: 8 }} wrap>
                  <Text>Status 4:</Text>
                  <Select
                    value={ticket.status_4 || undefined}
                    onChange={(v) => {
                      const updates: Partial<Ticket> = { status_4: v as Ticket['status_4'] }
                      if (v === 'completed') updates.actual_4 = new Date().toISOString()
                      handleUpdate(updates)
                    }}
                    style={{ width: 120 }}
                    placeholder="Select"
                    disabled={saving || readOnly}
                  >
                    <Select.Option value="completed">Completed</Select.Option>
                    <Select.Option value="pending">Pending</Select.Option>
                    <Select.Option value="na">NA</Select.Option>
                  </Select>
                </Space>
                <div style={{ marginTop: 8 }}>
                  <Text>Actual 4:</Text>
                  <Text style={{ marginLeft: 8 }}>{formatDateTable(ticket.actual_4) || '-'}</Text>
                </div>
                {stage4DelaySec > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <Tag color={getSlaColor(stage4DelaySec, SLA_2_HOUR)}>
                      Time Delay (SLA 2 hr): {formatDelay(stage4DelaySec)}
                    </Tag>
                  </div>
                )}
              </div>
            )}

            {/* FINAL AUTO CALCULATIONS (hidden in Completed Chores & Bugs read-only view) */}
            {actual4 > 0 && queryArrival > 0 && !completedViewOnlyTwoStages && (
              <div style={{ marginBottom: 20, padding: 12, background: '#f9f9f9', borderRadius: 8 }}>
                <Text strong>Final Metrics</Text>
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary">Confirmed Review: </Text>
                  {formatDelay(Math.max(0, Math.floor((actual4 - planned4) / 1000)))}
                </div>
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary">Elapsed Processing Time: </Text>
                  {formatDelay(Math.max(0, Math.floor((actual4 - queryArrival) / 1000)))}
                  {Math.floor((actual4 - queryArrival) / 1000) > SLA_1_DAY && (
                    <Tag color="red" style={{ marginLeft: 8 }}>Delay</Tag>
                  )}
                </div>
              </div>
            )}

            {/* QUALITY SOLUTION - Only when Status 4 = Completed */}
            {hasQualitySolution ? (
              <div style={{ marginTop: 16, padding: 12, background: '#f0f5ff', borderRadius: 8 }}>
                <Text strong>Quality of Solution</Text>
                <div style={{ marginTop: 8 }}>{ticket.quality_solution}</div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Submitted by {ticket.quality_solution_submitted_by} on{' '}
                  {formatDateTable(ticket.quality_solution_submitted_at)}
                </Text>
              </div>
            ) : canSubmitSolution && !readOnly && !level3Restricted ? (
              <div style={{ marginTop: 16 }}>
                <Button type="primary" onClick={() => setSolutionModalOpen(true)}>
                  Submit Solution Form
                </Button>
              </div>
            ) : showStage4 && status4 !== 'completed' ? (
              <div style={{ marginTop: 16 }}>
                <Text type="secondary">Complete Status 4 to submit Solution Form</Text>
              </div>
            ) : null}
          </>
        )}
      </Drawer>

      <Modal
        title="Edit Support Ticket"
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={submitEditTicket}
        okText="Save"
        confirmLoading={editSubmitting}
        okButtonProps={{ disabled: !canEditSupportTicket }}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Text strong>Title *</Text>
            <Input
              value={editForm.title}
              onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="Title"
            />
          </div>
          <div>
            <Text strong>Description</Text>
            <TextArea
              rows={3}
              value={editForm.description}
              onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Description"
            />
          </div>
          <div>
            <Text strong>Company *</Text>
            <Select
              showSearch
              optionFilterProp="label"
              value={editForm.company_id || undefined}
              placeholder="Select company"
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              onChange={(v) => {
                const nextCompanyId = String(v || '')
                setEditForm((p) => ({ ...p, company_id: nextCompanyId, division_id: '', division_other: '' }))
                if (nextCompanyId) {
                  supportApi.getDivisions(nextCompanyId, { bustCache: true }).then((rows) => setDivisions(rows || [])).catch(() => setDivisions([]))
                } else {
                  setDivisions([])
                }
              }}
            />
          </div>
          <div>
            <Text strong>Page *</Text>
            <Select
              showSearch
              optionFilterProp="label"
              value={editForm.page_id || undefined}
              placeholder="Select page"
              options={pages.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(v) => setEditForm((p) => ({ ...p, page_id: String(v || '') }))}
            />
          </div>
          <div>
            <Text strong>Division *</Text>
            <Select
              showSearch
              optionFilterProp="label"
              value={editForm.division_id || undefined}
              placeholder="Select division"
              options={divisions.map((d) => ({ value: d.id, label: d.name }))}
              onChange={(v) => {
                const nextDivisionId = String(v || '')
                const selected = divisions.find((d) => d.id === nextDivisionId)
                setEditForm((p) => ({
                  ...p,
                  division_id: nextDivisionId,
                  division_other: selected?.name === 'Other' ? p.division_other : '',
                }))
              }}
              disabled={!editForm.company_id}
            />
          </div>
          {divisions.find((d) => d.id === editForm.division_id)?.name === 'Other' && (
            <div>
              <Text strong>Other Division</Text>
              <Input
                value={editForm.division_other}
                onChange={(e) => setEditForm((p) => ({ ...p, division_other: e.target.value }))}
                placeholder="Specify division"
              />
            </div>
          )}
          <div>
            <Text strong>User Name *</Text>
            <Input
              value={editForm.user_name}
              onChange={(e) => setEditForm((p) => ({ ...p, user_name: e.target.value }))}
              placeholder="User Name"
            />
          </div>
          <div>
            <Text strong>CT</Text>
            <Select
              value={editForm.communicated_through || undefined}
              placeholder="Select communication type"
              options={[
                { value: 'phone', label: 'Phone' },
                { value: 'mail', label: 'Mail' },
                { value: 'whatsapp', label: 'WhatsApp' },
                { value: 'mom', label: 'MOM' },
              ]}
              onChange={(v) => setEditForm((p) => ({ ...p, communicated_through: String(v || '') }))}
              allowClear
            />
          </div>
          <div>
            <Text strong>Submitted By</Text>
            <Input
              value={editForm.submitted_by}
              onChange={(e) => setEditForm((p) => ({ ...p, submitted_by: e.target.value }))}
              placeholder="Submitted By"
            />
          </div>
          <div>
            <Text strong>Quality of Response *</Text>
            <Input
              value={editForm.quality_of_response}
              onChange={(e) => setEditForm((p) => ({ ...p, quality_of_response: e.target.value }))}
              placeholder="Quality of Response"
            />
          </div>
          <div>
            <Text strong>Customer Questions *</Text>
            <TextArea
              rows={2}
              value={editForm.customer_questions}
              onChange={(e) => setEditForm((p) => ({ ...p, customer_questions: e.target.value }))}
              placeholder="Customer Questions"
            />
          </div>
          <div>
            <Text strong>Query Arrival Date & Time *</Text>
            <DatePicker
              showTime={{ format: 'hh:mm A', use12Hours: true }}
              format="YYYY-MM-DD hh:mm A"
              style={{ width: '100%' }}
              value={editForm.query_arrival_at ? dayjs(editForm.query_arrival_at) : null}
              onChange={(d) => setEditForm((p) => ({ ...p, query_arrival_at: d ? d.toISOString() : '' }))}
              allowClear
            />
          </div>
          <div>
            <Text strong>Query Response Date & Time *</Text>
            <DatePicker
              showTime={{ format: 'hh:mm A', use12Hours: true }}
              format="YYYY-MM-DD hh:mm A"
              style={{ width: '100%' }}
              value={editForm.query_response_at ? dayjs(editForm.query_response_at) : null}
              onChange={(d) => setEditForm((p) => ({ ...p, query_response_at: d ? d.toISOString() : '' }))}
              allowClear
            />
          </div>
        </Space>
      </Modal>

      <Modal
        title="Submit Quality of Solution"
        open={solutionModalOpen}
        onCancel={() => setSolutionModalOpen(false)}
        onOk={handleSubmitSolution}
        confirmLoading={saving}
        okText="Submit"
      >
        <div style={{ marginBottom: 8 }}>
          <Text strong>Reference No: </Text>
          <PriorityColoredReference referenceNo={ticket?.reference_no} priority={ticket?.priority} strong={false} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <Text strong>Submitted By: </Text>
          {user?.full_name || user?.email || 'Unknown'}
        </div>
        <div>
          <Text strong>Quality of Solution (Remark) *</Text>
          <TextArea
            rows={4}
            value={solutionText}
            onChange={(e) => setSolutionText(e.target.value)}
            placeholder="Enter quality of solution remark (mandatory)"
            style={{ marginTop: 8 }}
          />
        </div>
      </Modal>

      <RepeatedTicketsModal
        ticketId={ticketId}
        ticketReference={ticket?.reference_no}
        open={repeatedOpen}
        onClose={() => setRepeatedOpen(false)}
        onUpdated={() => {
          onUpdate?.()
          if (ticketId) {
            ticketsApi.get(ticketId).then((res) => {
              const data = res && typeof res === 'object' && 'data' in res ? res.data : res
              if (data) setTicket(data as Ticket)
            })
          }
        }}
      />
    </>
  )
}
