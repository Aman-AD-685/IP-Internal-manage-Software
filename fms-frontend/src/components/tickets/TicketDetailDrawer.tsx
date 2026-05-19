import { useState, useEffect } from 'react'
import { Drawer, Descriptions, Tag, Typography, Input, Button, Space, message, Modal, Divider, Select } from 'antd'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import { ticketsApi } from '../../api/tickets'
import { formatDateTable, formatDuration, featureStage1DelaySeconds, featureStage2DelaySeconds, formatDelay } from '../../utils/helpers'
import type { Ticket } from '../../api/tickets'
import { useRole } from '../../hooks/useRole'
import { formatPriorityLabel, getPriorityTagColor } from '../../utils/ticketPriority'

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
  const { isUser, isMasterAdmin } = useRole()
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rejectModalOpen, setRejectModalOpen] = useState(false)
  const [rejectRemarks, setRejectRemarks] = useState('')
  const [approvalActionLoading, setApprovalActionLoading] = useState(false)

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
    if (!ticketId) return
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
    if (!ticketId || !rejectRemarks.trim()) {
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

  if (!ticket && !loading) return null

  return (
    <Drawer
      title={ticket?.title || 'Ticket Details'}
      placement="right"
      width={560}
      open={open}
      onClose={onClose}
      loading={loading}
    >
      {ticket && (
        <>
          <Descriptions column={1} size="small" bordered style={{ marginBottom: 24 }}>
            <Descriptions.Item label="Reference">{ticket.reference_no || '-'}</Descriptions.Item>
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
                  <Tag
                    color={
                      ticket.approval_status === 'approved'
                        ? 'green'
                        : ticket.approval_status === 'rejected'
                          ? 'red'
                          : ticket.approval_status === 'unapproved'
                            ? 'orange'
                            : 'default'
                    }
                  >
                    {ticket.approval_status === 'rejected'
                      ? 'Rejected'
                      : ticket.approval_status === 'unapproved'
                        ? 'Unapprove'
                        : ticket.approval_status === 'approved'
                          ? 'Approved'
                          : 'Pending'}
                  </Tag>
                  {ticket.remarks && (ticket.approval_status === 'rejected' || ticket.approval_status === 'unapproved') && (
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
                {approvalMode && (!isUser || isMasterAdmin) && (ticket.approval_status == null || ticket.approval_status === undefined) && (
                  <Descriptions.Item label="Actions">
                    <Space>
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
                    </Space>
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
                  if (v === 'completed' || v === 'staging' || v === 'hold') {
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
    </Drawer>
  )
}
