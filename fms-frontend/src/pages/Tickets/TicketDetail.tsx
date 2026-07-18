import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Card, Typography, Tag, Descriptions, Button, Space, message } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { ticketsApi } from '../../api/tickets'
import { DetailPageSkeleton } from '../../components/common/skeletons'
import { PrintExport } from '../../components/common/PrintExport'
import { formatDate } from '../../utils/helpers'
import { getStatusTagColor } from '../../utils/statusColors'
import { ROUTES } from '../../utils/constants'
import type { Ticket } from '../../api/tickets'
import { useTicketRealtimeRefresh } from '../../hooks/useTicketRealtimeRefresh'

const { Title } = Typography

/** Ticket is in Staging workflow and not yet completed Stage 3 */
function isStagingTicket(t: Ticket): boolean {
  const inStaging = !!t.staging_planned || t.status_2 === 'staging'
  const completed = t.live_review_status === 'completed'
  return inStaging && !completed
}

export const TicketDetail = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const returnTo = searchParams.get('returnTo') || ''
  const safeReturnTo = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : ''

  const fetchTicket = useCallback(async (opts?: { silent?: boolean }) => {
    if (!id) return
    if (!opts?.silent) setLoading(true)
    try {
      const response = await ticketsApi.get(id)
      if (response) {
        const t = response as Ticket
        setTicket(t)
        if (isStagingTicket(t)) {
          navigate(`${ROUTES.STAGING}?open=${id}`, { replace: true })
          return
        }
      }
    } catch (error) {
      if (!opts?.silent) message.error('Failed to load ticket')
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [id, navigate])

  useEffect(() => {
    if (id) {
      void fetchTicket()
    }
  }, [id, fetchTicket])

  useTicketRealtimeRefresh(!!id, id, () => {
    void fetchTicket({ silent: true })
  })

  if (loading) return <DetailPageSkeleton />
  if (!ticket) return <div>Ticket not found</div>

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(safeReturnTo || ROUTES.TICKETS)}>
          Back
        </Button>
        <Title level={2} className="page-main-heading" style={{ margin: 0 }}>
          {ticket.reference_no}
        </Title>
        <PrintExport pageTitle={`Ticket ${ticket.reference_no}`} />
      </Space>

      <Card>
        <Descriptions column={2} bordered>
          <Descriptions.Item label="Title">{ticket.title}</Descriptions.Item>
          <Descriptions.Item label="Status">
            <Tag color={getStatusTagColor(ticket.status)}>
              {ticket.status.replace('_', ' ').toUpperCase()}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Type">
            <Tag>{ticket.type.toUpperCase()}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Priority">
            {ticket.priority.toUpperCase()}
          </Descriptions.Item>
          <Descriptions.Item label="Created">
            {formatDate(ticket.created_at)}
          </Descriptions.Item>
          {ticket.resolved_at && (
            <Descriptions.Item label="Resolved">
              {formatDate(ticket.resolved_at)}
            </Descriptions.Item>
          )}
        </Descriptions>

        {ticket.description && (
          <div style={{ marginTop: 24 }}>
            <Title level={4}>Description</Title>
            <p>{ticket.description}</p>
          </div>
        )}

        {ticket.resolution_notes && (
          <div style={{ marginTop: 24 }}>
            <Title level={4}>Resolution Notes</Title>
            <p>{ticket.resolution_notes}</p>
          </div>
        )}
      </Card>
    </div>
  )
}
