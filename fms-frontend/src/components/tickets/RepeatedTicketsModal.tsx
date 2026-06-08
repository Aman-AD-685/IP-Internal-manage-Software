import { useEffect, useState } from 'react'
import { Button, Modal, Space, Spin, Tag, Typography, message } from 'antd'
import { LinkOutlined, RetweetOutlined } from '@ant-design/icons'
import { ticketsApi, type RepeatedChildTicket, type RepeatedTicketsResponse } from '../../api/tickets'
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

function typeLabel(item: RepeatedChildTicket): string {
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
  onViewTicket,
}: RepeatedTicketsModalProps) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RepeatedTicketsResponse | null>(null)

  useEffect(() => {
    if (!open || !ticketId) {
      setResult(null)
      return
    }
    setLoading(true)
    ticketsApi
      .getRepeats(ticketId)
      .then(setResult)
      .catch(() => {
        setResult(null)
        message.error('Could not load repeated tickets')
      })
      .finally(() => setLoading(false))
  }, [open, ticketId])

  const children = result?.children ?? []

  return (
    <Modal
      title={
        <Space>
          <RetweetOutlined />
          <span>
            Repeated tickets
            {ticketReference || result?.referenceNo ? ` — ${ticketReference || result?.referenceNo}` : ''}
          </span>
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
          <Spin /> <Text type="secondary">Loading tickets created from this issue…</Text>
        </div>
      ) : !result ? (
        <Text type="secondary">No repeat data available.</Text>
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text type="secondary">
            {result.childCount === 0
              ? 'No new tickets have been created from this ticket yet.'
              : `${result.childCount} ticket${result.childCount === 1 ? '' : 's'} created based on this issue (via Similar Ticket Suggestions).`}
          </Text>

          {children.length > 0 ? (
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
                  <div>Open</div>
                </div>
                {children.map((item) => (
                  <div key={item.id} className="similar-tickets-row similar-tickets-row--6col">
                    <div className="similar-tickets-row__ref">{item.reference_no}</div>
                    <div className="similar-tickets-row__title" title={item.title}>
                      {item.title}
                    </div>
                    <div className="similar-tickets-row__company" title={item.company_name}>
                      {item.company_name || '—'}
                    </div>
                    <div className="similar-tickets-row__type">{typeLabel(item)}</div>
                    <div className="similar-tickets-row__type">{item.stage || item.status_summary}</div>
                    <div className="similar-tickets-row__actions">
                      <Tag color={item.is_open ? 'orange' : 'default'}>
                        {item.is_open ? 'Open' : 'Closed'}
                      </Tag>
                      {onViewTicket ? (
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
          ) : null}
        </Space>
      )}
    </Modal>
  )
}
