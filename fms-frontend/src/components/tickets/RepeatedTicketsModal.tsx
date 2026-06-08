import { useEffect, useState } from 'react'
import { Button, Modal, Select, Space, Spin, Tag, Typography, message } from 'antd'
import { LinkOutlined, RetweetOutlined } from '@ant-design/icons'
import { ticketsApi, type RepeatedTicketMatch, type RepeatedTicketsResponse } from '../../api/tickets'
import { canUseSimilarTicketsSearch } from '../../utils/constants'
import { useAuth } from '../../hooks/useAuth'
import '../forms/similar-tickets-panel.css'

const { Text } = Typography

interface RepeatedTicketsModalProps {
  ticketId: string | null
  ticketReference?: string
  open: boolean
  onClose: () => void
  onUpdated?: () => void
  onViewTicket?: (ticketId: string, ticketType: 'chore' | 'bug' | 'feature') => void
}

function typeLabel(item: RepeatedTicketMatch): string {
  if (item.type_label) return item.type_label
  if (item.type === 'feature') return 'Feature'
  if (item.type === 'bug') return 'Bug'
  return 'Chores'
}

export function RepeatedTicketsModal({
  ticketId,
  ticketReference,
  open,
  onClose,
  onUpdated,
  onViewTicket,
}: RepeatedTicketsModalProps) {
  const { user } = useAuth()
  const canMarkRepeat = canUseSimilarTicketsSearch(user?.email)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<RepeatedTicketsResponse | null>(null)
  const [markParentId, setMarkParentId] = useState<string | undefined>()

  useEffect(() => {
    if (!open || !ticketId) {
      setResult(null)
      setMarkParentId(undefined)
      return
    }
    setLoading(true)
    ticketsApi
      .getRepeats(ticketId)
      .then((res) => {
        setResult(res)
        setMarkParentId(
          (res.repeatOfTicketId as string | undefined) ||
            (res.parentTicketId as string | undefined) ||
            undefined,
        )
      })
      .catch(() => {
        setResult(null)
        message.error('Could not load repeated tickets')
      })
      .finally(() => setLoading(false))
  }, [open, ticketId])

  const handleMarkRepeat = async () => {
    if (!ticketId || !markParentId) return
    if (markParentId === ticketId) {
      message.warning('Cannot link a ticket to itself')
      return
    }
    setSaving(true)
    try {
      await ticketsApi.markRepeat(ticketId, markParentId)
      message.success('Ticket marked as repeated')
      onUpdated?.()
      const refreshed = await ticketsApi.getRepeats(ticketId)
      setResult(refreshed)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(typeof detail === 'string' ? detail : 'Failed to mark as repeated')
    } finally {
      setSaving(false)
    }
  }

  const related = result?.related ?? []
  const openRelated = related.filter((r) => r.is_open && !r.is_self)
  const markOptions = related
    .filter((r) => !r.is_self)
    .map((r) => ({
      value: r.id,
      label: `${r.reference_no} · ${r.company_name || '—'} · ${r.stage || r.status_summary}`,
    }))

  return (
    <Modal
      title={
        <Space>
          <RetweetOutlined />
          <span>Repeated tickets{ticketReference ? ` — ${ticketReference}` : ''}</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnClose
    >
      {loading ? (
        <div className="similar-tickets-loading">
          <Spin /> <Text type="secondary">Loading cross-company repeats…</Text>
        </div>
      ) : !result ? (
        <Text type="secondary">No repeat data available.</Text>
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space wrap>
            {result.isRepeated ? (
              <Tag color="orange">Repeated issue</Tag>
            ) : (
              <Tag>No cross-company repeat</Tag>
            )}
            <Text type="secondary">
              {result.companyCount} compan{result.companyCount === 1 ? 'y' : 'ies'} ·{' '}
              {result.openRepeatCount} open (Pending/Hold)
            </Text>
            {result.repeatOfTicketId && result.parentReferenceNo ? (
              <Tag color="blue">Linked to {result.parentReferenceNo}</Tag>
            ) : null}
          </Space>

          {related.length > 0 ? (
            <div className="similar-tickets-panel" style={{ marginBottom: 0 }}>
              <div className="similar-tickets-panel__scroll">
                <div
                  className="similar-tickets-row similar-tickets-row--header similar-tickets-row--6col"
                  aria-hidden="true"
                >
                  <div>Ref No</div>
                  <div>Title</div>
                  <div>Company Name</div>
                  <div>Type</div>
                  <div>Stage</div>
                  <div>Match</div>
                </div>
                {related.map((item) => (
                  <div
                    key={item.id}
                    className="similar-tickets-row similar-tickets-row--6col"
                    style={item.is_self ? { background: 'rgba(22, 119, 255, 0.08)' } : undefined}
                  >
                    <div className="similar-tickets-row__ref">
                      {item.reference_no}
                      {item.is_self ? (
                        <div>
                          <Tag color="processing" style={{ marginTop: 2, fontSize: 10 }}>
                            This ticket
                          </Tag>
                        </div>
                      ) : null}
                    </div>
                    <div className="similar-tickets-row__title" title={item.title}>
                      {item.title}
                    </div>
                    <div className="similar-tickets-row__company" title={item.company_name}>
                      {item.company_name || '—'}
                    </div>
                    <div className="similar-tickets-row__type">{typeLabel(item)}</div>
                    <div className="similar-tickets-row__type">{item.stage || item.status_summary}</div>
                    <div className="similar-tickets-row__actions">
                      <Tag color={item.match_score >= 90 ? 'blue' : 'default'}>{item.match_score}%</Tag>
                      {onViewTicket && !item.is_self ? (
                        <Button
                          type="link"
                          size="small"
                          icon={<LinkOutlined />}
                          onClick={() => onViewTicket(item.id, item.type)}
                          style={{ padding: 0, height: 'auto' }}
                        >
                          View
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Text type="secondary">No similar tickets found for this title.</Text>
          )}

          {canMarkRepeat && markOptions.length > 0 ? (
            <Space wrap style={{ width: '100%' }}>
              <Select
                style={{ minWidth: 280, flex: 1 }}
                placeholder="Mark this ticket as repeated of…"
                options={markOptions}
                value={markParentId}
                onChange={setMarkParentId}
                showSearch
                optionFilterProp="label"
              />
              <Button type="primary" loading={saving} onClick={handleMarkRepeat} disabled={!markParentId}>
                Mark as repeated
              </Button>
            </Space>
          ) : null}

          {result.isRepeated && openRelated.length > 0 ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Same problem is still open at {openRelated.length} other compan
              {openRelated.length === 1 ? 'y' : 'ies'} — consider one fix for all.
            </Text>
          ) : null}
        </Space>
      )}
    </Modal>
  )
}
