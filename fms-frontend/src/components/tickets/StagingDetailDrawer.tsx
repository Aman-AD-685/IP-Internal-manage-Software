import { useState, useEffect, useCallback } from 'react'
import {
  Drawer,
  Descriptions,
  Tag,
  Typography,
  Select,
  Space,
  message,
  Divider,
  Button,
} from 'antd'
import { RollbackOutlined } from '@ant-design/icons'
import { ticketsApi } from '../../api/tickets'
import { useRole } from '../../hooks/useRole'
import { formatDateTable, formatDelay, stagingDelaySeconds } from '../../utils/helpers'
import type { Ticket } from '../../api/tickets'
import { useTicketRealtimeRefresh } from '../../hooks/useTicketRealtimeRefresh'

const { Text } = Typography
const SLA_2H = 2 * 3600

interface StagingDetailDrawerProps {
  ticketId: string | null
  open: boolean
  onClose: () => void
  onUpdate?: () => void
  readOnly?: boolean
}

export const StagingDetailDrawer = ({
  ticketId,
  open,
  onClose,
  onUpdate,
  readOnly = false,
}: StagingDetailDrawerProps) => {
  const { isMasterAdmin } = useRole()
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [backing, setBacking] = useState(false)

  useEffect(() => {
    if (open && ticketId) {
      setLoading(true)
      ticketsApi
        .get(ticketId)
        .then((res) => {
          const raw = res && typeof res === 'object' ? res as Record<string, unknown> : null
          const t =
            raw && typeof raw === 'object' && 'id' in raw
              ? (raw as Ticket)
              : raw?.data && typeof raw.data === 'object' && raw.data !== null && 'id' in (raw.data as object)
                ? (raw.data as Ticket)
                : null
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
      .then((res) => {
        const raw = res && typeof res === 'object' ? (res as Record<string, unknown>) : null
        const t =
          raw && 'id' in raw
            ? (raw as unknown as Ticket)
            : raw?.data && typeof raw.data === 'object' && raw.data !== null && 'id' in (raw.data as object)
              ? (raw.data as unknown as Ticket)
              : null
        if (t) setTicket(t)
      })
      .catch(() => {})
  }, [ticketId])

  useTicketRealtimeRefresh(open, ticketId, refreshFromRealtime)

  const handleUpdate = async (updates: Partial<Ticket>) => {
    if (!ticketId || readOnly) return
    setSaving(true)
    try {
      const payload = { ...updates, approval_status: updates.approval_status ?? undefined }
      await ticketsApi.update(ticketId, payload)
      const fresh = await ticketsApi.get(ticketId)
      const raw = fresh && typeof fresh === 'object' ? (fresh as Record<string, unknown>) : null
      const t =
        raw && 'id' in raw ? (raw as Ticket) : raw?.data && typeof raw.data === 'object' && raw.data !== null && 'id' in (raw.data as object) ? (raw.data as Ticket) : null
      setTicket(t)
      onUpdate?.()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail || 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  const stage1Delay = stagingDelaySeconds(
    ticket?.staging_planned,
    ticket?.staging_review_status,
    ticket?.staging_review_actual
  )
  const stage2Delay = stagingDelaySeconds(
    ticket?.live_planned,
    ticket?.live_status,
    ticket?.live_actual
  )
  const stage3Delay = stagingDelaySeconds(
    ticket?.live_review_planned,
    ticket?.live_review_status,
    ticket?.live_review_actual
  )
  const showStage2 = ticket?.staging_review_status === 'completed'
  const showStage3 = ticket?.live_status === 'completed'

  return (
    <Drawer
      title={ticket?.title || 'Staging Details'}
      placement="right"
      width={640}
      open={open}
      onClose={onClose}
      loading={loading}
    >
      {!loading && !ticket && (
        <Text type="secondary">Failed to load ticket. It may have been deleted or you may not have access.</Text>
      )}
      {ticket && (
        <>
          <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Reference No">{ticket.reference_no || '-'}</Descriptions.Item>
            <Descriptions.Item label="Timestamp">{formatDateTable(ticket.created_at)}</Descriptions.Item>
            <Descriptions.Item label="Title">{ticket.title || '-'}</Descriptions.Item>
            <Descriptions.Item label="Type">
              <Tag color={ticket.type === 'chore' ? 'green' : ticket.type === 'bug' ? 'red' : 'blue'}>
                {ticket.type === 'chore' ? 'Chores' : ticket.type === 'bug' ? 'Bug' : 'Feature'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Company Name">{ticket.company_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="Division">{ticket.division_name || '-'}</Descriptions.Item>
          </Descriptions>

          <Divider />

          {/* Stage 1: Staging — Pending, Completed & Back */}
          <div style={{ marginBottom: 20, padding: 12, background: '#e6f7ff', borderRadius: 8 }}>
            <Text strong style={{ color: '#1890ff' }}>Stage 1: Staging Planned</Text>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">Staging Planned: </Text>
              {formatDateTable(ticket.staging_planned)}
            </div>
            {!readOnly && (
              <Space style={{ marginTop: 8 }} wrap>
                <Text>Staging Review Status:</Text>
                <Select
                  aria-label="Staging review status"
                  value={ticket.staging_review_status || undefined}
                  onChange={(v) => handleUpdate({ staging_review_status: v as 'pending' | 'completed' })}
                  style={{ width: 120 }}
                  placeholder="Select"
                  disabled={saving}
                  options={[
                    { value: 'pending', label: 'Pending' },
                    { value: 'completed', label: 'Completed' },
                  ]}
                />
                {((ticket.staging_review_status !== 'completed') || isMasterAdmin) && (
                  <Button
                    type="default"
                    icon={<RollbackOutlined />}
                    loading={backing}
                    onClick={async () => {
                      if (!ticketId) return
                      setBacking(true)
                      try {
                        await ticketsApi.stagingBack(ticketId)
                        message.success('Ticket moved back to Chores & Bugs. Staging data cleared.')
                        onUpdate?.()
                        onClose()
                      } catch (e: unknown) {
                        const err = e as { response?: { data?: { detail?: string } } }
                        message.error(err?.response?.data?.detail || 'Failed to move back')
                      } finally {
                        setBacking(false)
                      }
                    }}
                  >
                    Back
                  </Button>
                )}
              </Space>
            )}
            {readOnly && (
              <div style={{ marginTop: 8 }}>
                <Text>Staging Review Status: </Text>
                <Tag>{ticket.staging_review_status || 'Pending'}</Tag>
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              <Text>Review Actual: </Text>
              {formatDateTable(ticket.staging_review_actual)}
            </div>
            {stage1Delay > 0 && (
              <div style={{ marginTop: 8 }}>
                <Tag color={stage1Delay > SLA_2H ? 'red' : 'gold'}>
                  Staging Delay: {formatDelay(stage1Delay)}
                </Tag>
              </div>
            )}
          </div>

          {/* Stage 2: Live */}
          {showStage2 && (
            <div style={{ marginBottom: 20, padding: 12, background: '#f6ffed', borderRadius: 8 }}>
              <Text strong style={{ color: '#52c41a' }}>Stage 2: Live Planned</Text>
              <div style={{ marginTop: 8 }}>
                <Text type="secondary">Live Planned: </Text>
                {formatDateTable(ticket.live_planned || ticket.staging_review_actual)}
              </div>
              {!readOnly && (
                <Space style={{ marginTop: 8 }} wrap>
                  <Text>Live Status:</Text>
                  <Select
                    aria-label="Live status"
                    value={ticket.live_status || undefined}
                    onChange={(v) => handleUpdate({ live_status: v as 'pending' | 'completed' })}
                    style={{ width: 120 }}
                    placeholder="Select"
                    disabled={saving}
                    options={[
                      { value: 'pending', label: 'Pending' },
                      { value: 'completed', label: 'Completed' },
                    ]}
                  />
                </Space>
              )}
              {readOnly && (
                <div style={{ marginTop: 8 }}>
                  <Text>Live Status: </Text>
                  <Tag>{ticket.live_status || 'Pending'}</Tag>
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                <Text>Live Actual: </Text>
                {formatDateTable(ticket.live_actual)}
              </div>
              {stage2Delay > 0 && (
                <div style={{ marginTop: 8 }}>
                  <Tag color={stage2Delay > SLA_2H ? 'red' : 'gold'}>
                    Delay in Push Live: {formatDelay(stage2Delay)}
                  </Tag>
                </div>
              )}
            </div>
          )}

          {/* Stage 3: Live Review */}
          {showStage3 && (
            <div style={{ marginBottom: 20, padding: 12, background: '#fffbe6', borderRadius: 8 }}>
              <Text strong style={{ color: '#faad14' }}>Stage 3: Review Planned</Text>
              <div style={{ marginTop: 8 }}>
                <Text type="secondary">Live Review Planned: </Text>
                {formatDateTable(ticket.live_review_planned || ticket.live_actual)}
              </div>
              {!readOnly && (
                <Space style={{ marginTop: 8 }} wrap>
                  <Text>Live Review Status:</Text>
                  <Select
                    aria-label="Live review status"
                    value={ticket.live_review_status || undefined}
                    onChange={(v) => handleUpdate({ live_review_status: v as 'pending' | 'completed' })}
                    style={{ width: 120 }}
                    placeholder="Select"
                    disabled={saving}
                    options={[
                      { value: 'pending', label: 'Pending' },
                      { value: 'completed', label: 'Completed' },
                    ]}
                  />
                </Space>
              )}
              {readOnly && (
                <div style={{ marginTop: 8 }}>
                  <Text>Live Review Status: </Text>
                  <Tag>{ticket.live_review_status || 'Pending'}</Tag>
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                <Text>Live Review Actual: </Text>
                {formatDateTable(ticket.live_review_actual)}
              </div>
              {stage3Delay > 0 && (
                <div style={{ marginTop: 8 }}>
                  <Tag color={stage3Delay > SLA_2H ? 'red' : 'gold'}>
                    Live Delay in Review: {formatDelay(stage3Delay)}
                  </Tag>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Drawer>
  )
}
