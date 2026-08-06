import { useState, useEffect, useCallback } from 'react'
import { Drawer, Descriptions, Tag, Typography, Input, Button, Space, message, Modal, Divider, Select } from 'antd'
import { CheckOutlined, CloseOutlined, PauseCircleOutlined, UndoOutlined, RetweetOutlined } from '@ant-design/icons'
import { ticketsApi } from '../../api/tickets'
import { formatDateTable, formatDuration, featureStage1DelaySeconds, featureStage2DelaySeconds, formatDelay } from '../../utils/helpers'
import type { Ticket } from '../../api/tickets'
import { useAuth } from '../../hooks/useAuth'
import { useRole } from '../../hooks/useRole'
import { formatPriorityLabel, getPriorityTagColor } from '../../utils/ticketPriority'
import { getStatusTagColor } from '../../utils/statusColors'
import { useTicketRealtimeRefresh } from '../../hooks/useTicketRealtimeRefresh'
import { RepeatedTicketsModal } from './RepeatedTicketsModal'
import { PriorityColoredReference } from './PriorityColoredReference'

const { TextArea } = Input
const { Text } = Typography

/** Stage block: Planned, Status (editable), Actual - for Feature drawer */
const FeatureStageBlock = ({
  title,
  planned,
  status,
  actual,
  bg,
  statusOptions,
  onStatusChange,
  saving,
  readOnly,
  delaySeconds,
}: {
  title: string
  planned: string
  status: string
  actual: string
  bg: string
  statusOptions: { value: string; label: string }[]
  onStatusChange?: (v: string) => void
  saving?: boolean
  readOnly?: boolean
  delaySeconds?: number
}) => (
  <div style={{ marginBottom: 16, padding: 12, background: bg, borderRadius: 8 }}>
    <Text strong>{title}</Text>
    <Descriptions column={1} size="small" style={{ marginTop: 8 }}>
      <Descriptions.Item label="Planned">{planned}</Descriptions.Item>
      <Descriptions.Item label="Status">
        {readOnly || !onStatusChange ? (
          <Tag>{status || '-'}</Tag>
        ) : (
          <Select
            value={status || undefined}
            onChange={onStatusChange}
            style={{ width: 140 }}
            placeholder="Select"
            disabled={saving}
            getPopupContainer={() => document.body}
            options={statusOptions}
          />
        )}
      </Descriptions.Item>
      <Descriptions.Item label="Actual">{actual}</Descriptions.Item>
      {delaySeconds != null && delaySeconds > 0 && (
        <Descriptions.Item label="Delay">
          <Tag color={delaySeconds > 2 * 3600 ? 'red' : 'gold'}>{formatDelay(delaySeconds)}</Tag>
        </Descriptions.Item>
      )}
    </Descriptions>
  </div>
)

interface TicketDetailDrawerProps {
  ticketId: string | null
  open: boolean
  onClose: () => void
  onUpdate?: () => void
  readOnly?: boolean
  /** When true (Approval Status section), show Approve / Rejected with remarks required on reject */
  approvalMode?: boolean
}

const getTypeColor = (type: string) => (type === 'chore' ? 'green' : type === 'bug' ? 'red' : 'blue')
export const TicketDetailDrawer = ({ ticketId, open, onClose, onUpdate, readOnly = false, approvalMode = false }: TicketDetailDrawerProps) => {
  const { user } = useAuth()
  const { isUser, isMasterAdmin } = useRole()
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rejectModalOpen, setRejectModalOpen] = useState(false)
  const [rejectRemarks, setRejectRemarks] = useState('')
  const [holdModalOpen, setHoldModalOpen] = useState(false)
  const [holdRemarks, setHoldRemarks] = useState('')
  const [approvalActionLoading, setApprovalActionLoading] = useState(false)
  const [solutionModalOpen, setSolutionModalOpen] = useState(false)
  const [solutionText, setSolutionText] = useState('')
  const [repeatedOpen, setRepeatedOpen] = useState(false)
  const [submittingSolution, setSubmittingSolution] = useState(false)

  const handleFeatureStageUpdate = async (updates: Partial<Ticket>) => {
    if (!ticketId || readOnly || approvalMode) return
    setSaving(true)
    try {
      await ticketsApi.update(ticketId, updates)
      const fresh = await ticketsApi.get(ticketId)
      setTicket(fresh && typeof fresh === 'object' ? (fresh as Ticket) : null)
      onUpdate?.()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail || 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (open && ticketId) {
      setLoading(true)
      ticketsApi
        .get(ticketId)
        .then((tRes) => {
          const t = tRes && typeof tRes === 'object' && 'id' in tRes ? (tRes as Ticket) : null
          setTicket(t)
        })
        .catch(() => message.error('Failed to load ticket'))
        .finally(() => setLoading(false))
    } else {
      setTicket(null)
    }
  }, [open, ticketId])

  const refreshFromRealtime = useCallback(() => {
    if (!ticketId) return
    ticketsApi
      .get(ticketId)
      .then((tRes) => {
        const t = tRes && typeof tRes === 'object' && 'id' in tRes ? (tRes as Ticket) : null
        if (t) setTicket(t)
      })
      .catch(() => {})
  }, [ticketId])

  useTicketRealtimeRefresh(open, ticketId, refreshFromRealtime)

  const handleUpdateRemarks = async (remarks: string) => {
    if (!ticketId) return
    try {
      await ticketsApi.update(ticketId, { remarks })
      setTicket((t) => (t ? { ...t, remarks } : null))
      onUpdate?.()
    } catch {
      message.error('Failed to update remarks')
    }
  }

  const handleApprove = async () => {
    if (!ticketId || readOnly) return
    setApprovalActionLoading(true)
    try {
      await ticketsApi.update(ticketId, { approval_status: 'approved' })
      const fresh = await ticketsApi.get(ticketId)
      setTicket(fresh && typeof fresh === 'object' ? (fresh as Ticket) : null)
      onUpdate?.()
      message.success('Feature ticket approved. Thank you, Approver.')
      onClose()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail || 'Failed to approve')
    } finally {
      setApprovalActionLoading(false)
    }
  }

  const handleRejectOpen = () => {
    setRejectRemarks('')
    setRejectModalOpen(true)
  }

  const handleRejectSubmit = async () => {
    if (!ticketId || readOnly || !rejectRemarks.trim()) {
      message.error('Remarks are required when rejecting a feature request')
      return
    }
    setApprovalActionLoading(true)
    try {
      await ticketsApi.update(ticketId, {
        approval_status: 'rejected',
        remarks: rejectRemarks.trim(),
      })
      const fresh = await ticketsApi.get(ticketId)
      setTicket(fresh && typeof fresh === 'object' ? (fresh as Ticket) : null)
      onUpdate?.()
      message.success('Feature ticket rejected. Remarks saved.')
      setRejectModalOpen(false)
      setRejectRemarks('')
      onClose()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail || 'Failed to reject')
    } finally {
      setApprovalActionLoading(false)
    }
  }

  const handleHoldOpen = () => {
    setHoldRemarks('')
    setHoldModalOpen(true)
  }

  const handleHoldSubmit = async () => {
    if (!ticketId || readOnly || !holdRemarks.trim()) {
      message.error('Hold remarks are required')
      return
    }
    setApprovalActionLoading(true)
    try {
      await ticketsApi.update(ticketId, {
        approval_status: 'hold',
        remarks: holdRemarks.trim(),
      })
      const fresh = await ticketsApi.get(ticketId)
      setTicket(fresh && typeof fresh === 'object' ? (fresh as Ticket) : null)
      onUpdate?.()
      message.success('Feature ticket placed on hold. Remarks saved.')
      setHoldModalOpen(false)
      setHoldRemarks('')
      onClose()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail || 'Failed to place on hold')
    } finally {
      setApprovalActionLoading(false)
    }
  }

  const handleBackToPending = async () => {
    if (!ticketId || readOnly) return
    setApprovalActionLoading(true)
    try {
      await ticketsApi.update(ticketId, { approval_status: null })
      const fresh = await ticketsApi.get(ticketId)
      setTicket(fresh && typeof fresh === 'object' ? (fresh as Ticket) : null)
      onUpdate?.()
      message.success('Returned to pending approval.')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail || 'Failed to update')
    } finally {
      setApprovalActionLoading(false)
    }
  }

  const handleSubmitSolution = async () => {
    if (!ticketId || readOnly || !solutionText.trim()) {
      message.error('Quality of Solution is required')
      return
    }
    setSubmittingSolution(true)
    try {
      await ticketsApi.submitQualitySolution(ticketId, solutionText.trim())
      const fresh = await ticketsApi.get(ticketId)
      setTicket(fresh && typeof fresh === 'object' ? (fresh as Ticket) : null)
      setSolutionModalOpen(false)
      setSolutionText('')
      onUpdate?.()
      message.success('Solution submitted')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail || 'Failed to submit solution')
    } finally {
      setSubmittingSolution(false)
    }
  }

  if (!ticket && !loading) return null

  /** Feature final stage complete: normal flow ends at Stage 2 (live_status); if it went through staging, ends at Stage 3 (live_review_status). */
  const featureFinalCompleted =
    ticket?.type === 'feature' &&
    (ticket?.staging_planned
      ? ticket?.live_review_status === 'completed'
      : ticket?.live_status === 'completed')
  const hasQualitySolution = !!ticket?.quality_solution
  const canSubmitFeatureSolution = featureFinalCompleted && !hasQualitySolution

  return (
    <>
    <Drawer
      title={ticket?.title || 'Ticket Details'}
      placement="right"
      width={560}
      open={open}
      onClose={onClose}
      loading={loading}
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
          <Descriptions column={1} size="small" bordered style={{ marginBottom: 24 }}>
            <Descriptions.Item label="Reference">
              <PriorityColoredReference
                referenceNo={ticket.reference_no}
                priority={ticket.priority}
                claudeReviewed={Boolean(ticket.claude_reviewed_at)}
                claudeReviewDisplay="label"
              />
            </Descriptions.Item>
            {ticket.source_reference_no && (
              <Descriptions.Item label="Originally logged as">
                <Space>
                  <Text>{ticket.source_reference_no}</Text>
                  <Tag color={ticket.source_type === 'bug' ? 'red' : 'green'}>
                    {ticket.source_type === 'bug' ? 'Bug' : 'Chore'}
                  </Tag>
                </Space>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="Company">{ticket.company_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="User Name">{ticket.user_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="Page">{ticket.page_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="Division">{ticket.division_name || '-'}</Descriptions.Item>
            {ticket.division_other && (
              <Descriptions.Item label="Other Division">{ticket.division_other}</Descriptions.Item>
            )}
            <Descriptions.Item label="Type">
              <Tag color={getTypeColor(ticket.type)}>{ticket.type.toUpperCase()}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Priority">
              <Tag color={getPriorityTagColor(ticket.priority)}>{formatPriorityLabel(ticket.priority)}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Submitted By">{ticket.submitted_by || '-'}</Descriptions.Item>
            <Descriptions.Item label="Query Arrival">{formatDateTable(ticket.query_arrival_at)}</Descriptions.Item>
            <Descriptions.Item label="Query Response">{formatDateTable(ticket.query_response_at)}</Descriptions.Item>
            {ticket.type === 'feature' && (
              <>
                <Descriptions.Item label="Actual Time">{formatDuration(ticket.actual_time_seconds)}</Descriptions.Item>
                <Descriptions.Item label="Approval Status">
                  <Tag color={getStatusTagColor(ticket.approval_status ?? 'pending')}>
                    {ticket.approval_status === 'rejected'
                      ? 'Rejected'
                      : ticket.approval_status === 'hold'
                        ? 'Hold'
                        : ticket.approval_status === 'unapproved'
                          ? 'Unapprove'
                          : ticket.approval_status === 'approved'
                            ? 'Approved'
                            : 'Pending'}
                  </Tag>
                  {ticket.remarks &&
                    (ticket.approval_status === 'rejected' ||
                      ticket.approval_status === 'unapproved' ||
                      ticket.approval_status === 'hold') && (
                    <div style={{ marginTop: 4 }}>
                      <Text type="secondary">Remarks: {ticket.remarks}</Text>
                    </div>
                  )}
                  {ticket.approval_actual_at && (
                    <div style={{ marginTop: 4 }}>
                      <Text type="secondary">Approved at: {formatDateTable(ticket.approval_actual_at)}</Text>
                    </div>
                  )}
                  {ticket.unapproval_actual_at && (
                    <div style={{ marginTop: 4 }}>
                      <Text type="secondary">Unapproved at: {formatDateTable(ticket.unapproval_actual_at)}</Text>
                    </div>
                  )}
                </Descriptions.Item>
                {approvalMode && !readOnly && (!isUser || isMasterAdmin) && (ticket.approval_status == null || ticket.approval_status === undefined) && (
                  <Descriptions.Item label="Actions">
                    <Space wrap>
                      <Button
                        type="primary"
                        icon={<CheckOutlined />}
                        loading={approvalActionLoading}
                        onClick={handleApprove}
                      >
                        Approve
                      </Button>
                      <Button
                        danger
                        icon={<CloseOutlined />}
                        loading={approvalActionLoading}
                        onClick={handleRejectOpen}
                      >
                        Rejected
                      </Button>
                      <Button
                        icon={<PauseCircleOutlined />}
                        loading={approvalActionLoading}
                        onClick={handleHoldOpen}
                        style={{ borderColor: '#faad14', color: '#d48806' }}
                      >
                        Hold
                      </Button>
                    </Space>
                  </Descriptions.Item>
                )}
                {approvalMode && !readOnly && (!isUser || isMasterAdmin) && ticket.approval_status === 'hold' && (
                  <Descriptions.Item label="Actions">
                    <Button
                      icon={<UndoOutlined />}
                      loading={approvalActionLoading}
                      onClick={handleBackToPending}
                    >
                      Back to pending approval
                    </Button>
                  </Descriptions.Item>
                )}
              </>
            )}
          </Descriptions>

          {ticket.type === 'feature' ? (
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 24 }}>
              <Descriptions.Item label="Title">{ticket.title || '-'}</Descriptions.Item>
              <Descriptions.Item label="Description">
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {ticket.description || '-'}
                </div>
              </Descriptions.Item>
              <Descriptions.Item label="Customer Questions">
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {ticket.customer_questions || '-'}
                </div>
              </Descriptions.Item>
              <Descriptions.Item label="Why Feature?">
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {ticket.why_feature || '-'}
                </div>
              </Descriptions.Item>
            </Descriptions>
          ) : (
            <>
              <Text strong>Description</Text>
              <div style={{ marginBottom: 24, marginTop: 4 }}>{ticket.description || '-'}</div>

              <Text strong>Customer Questions</Text>
              <div style={{ marginBottom: 24, marginTop: 4 }}>{ticket.customer_questions || '-'}</div>
            </>
          )}

          {ticket.type === 'feature' && (
            <>
              <Divider orientation="left">Stage</Divider>
              <FeatureStageBlock
                title="Stage 1"
                planned={formatDateTable(ticket.query_arrival_at || ticket.created_at) || '-'}
                status={ticket.status_2 ?? 'pending'}
                actual={formatDateTable(ticket.actual_1) || '-'}
                bg="#e6f7ff"
                delaySeconds={featureStage1DelaySeconds(ticket.query_arrival_at || ticket.created_at, ticket.status_2, ticket.actual_1)}
                statusOptions={[
                  { value: 'pending', label: 'Pending' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'staging', label: 'Staging' },
                  { value: 'hold', label: 'Hold' },
                  { value: 'na', label: 'NA' },
                ]}
                onStatusChange={(v) => {
                  const nowIso = new Date().toISOString()
                  const updates: Partial<Ticket> = { status_2: v as Ticket['status_2'] }
                  if (v === 'completed' || v === 'staging' || v === 'hold' || v === 'na') {
                    updates.actual_1 = nowIso
                    if (v === 'completed') {
                      updates.planned_2 = nowIso
                      updates.live_planned = nowIso
                    }
                    if (v === 'staging') {
                      updates.staging_planned = nowIso
                      updates.staging_review_status = 'pending'
                    }
                  }
                  handleFeatureStageUpdate(updates)
                }}
                saving={saving}
                readOnly={readOnly || approvalMode}
              />
              {ticket.status_2 === 'completed' && (
                <FeatureStageBlock
                  title="Stage 2"
                  planned={formatDateTable(ticket.actual_1 || ticket.live_planned) || '-'}
                  status={ticket.live_status ?? 'pending'}
                  actual={formatDateTable(ticket.live_actual) || '-'}
                  bg="#f6ffed"
                  delaySeconds={featureStage2DelaySeconds(ticket.actual_1 || ticket.live_planned, ticket.live_status, ticket.live_actual)}
                  statusOptions={[
                    { value: 'pending', label: 'Pending' },
                    { value: 'completed', label: 'Completed' },
                  ]}
                  onStatusChange={(v) => {
                    const nowIso = new Date().toISOString()
                    const updates: Partial<Ticket> = { live_status: v as 'pending' | 'completed' }
                    if (v === 'completed') {
                      updates.live_actual = nowIso
                      if (ticket.actual_1) updates.live_planned = ticket.actual_1
                    }
                    handleFeatureStageUpdate(updates)
                  }}
                  saving={saving}
                  readOnly={readOnly || approvalMode || (!!ticket?.feature_stage_2_edit_used && !isMasterAdmin)}
                />
              )}
            </>
          )}

          {/* QUALITY SOLUTION (Feature) — mandatory after the final stage completes */}
          {ticket.type === 'feature' && !approvalMode && (
            hasQualitySolution ? (
              <div style={{ marginTop: 16, marginBottom: 24, padding: 12, background: '#f0f5ff', borderRadius: 8 }}>
                <Text strong>Quality of Solution</Text>
                <div style={{ marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {ticket.quality_solution}
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Submitted by {ticket.quality_solution_submitted_by} on{' '}
                  {formatDateTable(ticket.quality_solution_submitted_at)}
                </Text>
              </div>
            ) : canSubmitFeatureSolution ? (
              <div style={{ marginTop: 16, marginBottom: 24 }}>
                <Button type="primary" onClick={() => setSolutionModalOpen(true)}>
                  Submit Solution Form
                </Button>
              </div>
            ) : !featureFinalCompleted ? (
              <div style={{ marginTop: 16, marginBottom: 24 }}>
                <Text type="secondary">Complete the final stage to submit the Solution Form</Text>
              </div>
            ) : null
          )}

          {ticket.type === 'feature' && !approvalMode && (
            <>
              <Text strong>Remarks</Text>
              <TextArea
                key={ticket.id}
                rows={2}
                defaultValue={ticket.remarks || ''}
                onBlur={(e) => !readOnly && handleUpdateRemarks(e.target.value)}
                placeholder="Add remarks..."
                style={{ marginTop: 4, marginBottom: 24 }}
                readOnly={readOnly}
              />
            </>
          )}

        </>
      )}

      <Modal
        title="Rejected – Remarks required"
        open={rejectModalOpen}
        onCancel={() => setRejectModalOpen(false)}
        onOk={handleRejectSubmit}
        okText="Confirm rejection"
        confirmLoading={approvalActionLoading}
        destroyOnClose
        okButtonProps={{ disabled: !rejectRemarks.trim() }}
      >
        <Text strong>Remarks *</Text>
        <TextArea
          rows={4}
          value={rejectRemarks}
          onChange={(e) => setRejectRemarks(e.target.value)}
          placeholder="Enter remarks (required for rejection)"
          style={{ marginTop: 8, width: '100%' }}
        />
      </Modal>
      <Modal
        title="Hold – Remarks required"
        open={holdModalOpen}
        onCancel={() => setHoldModalOpen(false)}
        onOk={handleHoldSubmit}
        okText="Confirm hold"
        confirmLoading={approvalActionLoading}
        destroyOnClose
        okButtonProps={{ disabled: !holdRemarks.trim() }}
      >
        <Text strong>Hold remarks *</Text>
        <TextArea
          rows={4}
          value={holdRemarks}
          onChange={(e) => setHoldRemarks(e.target.value)}
          placeholder="Enter hold remarks (required)"
          style={{ marginTop: 8, width: '100%' }}
        />
      </Modal>
      <Modal
        title="Submit Quality of Solution"
        open={solutionModalOpen}
        onCancel={() => setSolutionModalOpen(false)}
        onOk={handleSubmitSolution}
        confirmLoading={submittingSolution}
        okText="Submit"
        okButtonProps={{ disabled: !solutionText.trim() }}
        destroyOnClose
      >
        <div style={{ marginBottom: 8 }}>
          <Text strong>Reference No: </Text>
          <PriorityColoredReference
            referenceNo={ticket?.reference_no}
            priority={ticket?.priority}
            strong={false}
            claudeReviewed={Boolean(ticket?.claude_reviewed_at)}
            claudeReviewDisplay="label"
          />
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
    </Drawer>

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
