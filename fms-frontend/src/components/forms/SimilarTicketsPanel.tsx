import { Alert, Button, List, Space, Spin, Tag, Typography } from 'antd'
import { HistoryOutlined, LinkOutlined } from '@ant-design/icons'
import type { SimilarTicketsResponse } from '../../api/tickets'
import { formatDateTable } from '../../utils/helpers'

const { Text } = Typography

interface SimilarTicketsPanelProps {
  result: SimilarTicketsResponse | null
  loading?: boolean
  scopeReady?: boolean
  scopeHint?: string
  onViewTicket?: (ticketId: string, ticketType: 'chore' | 'bug' | 'feature') => void
}

export function SimilarTicketsPanel({
  result,
  loading,
  scopeReady = true,
  scopeHint,
  onViewTicket,
}: SimilarTicketsPanelProps) {
  if (!scopeReady) {
    return (
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary">{scopeHint || 'Enter at least 6 characters in Title to search all companies.'}</Text>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ marginBottom: 16 }}>
        <Spin size="small" /> <Text type="secondary">Searching similar titles across all companies…</Text>
      </div>
    )
  }

  if (!result || result.repeat_count === 0) {
    return null
  }

  const openCount = result.matches.filter((m) => m.is_open).length

  return (
    <Alert
      type={result.has_open_repeat ? 'warning' : 'info'}
      showIcon
      icon={<HistoryOutlined />}
      style={{ marginBottom: 16 }}
      message={
        <Space direction="vertical" size={2}>
          <Space wrap>
            <Text strong>
              Similar title found ({result.repeat_count} ticket{result.repeat_count === 1 ? '' : 's'} · all companies)
            </Text>
            {openCount > 0 && <Tag color="orange">{openCount} still open</Tag>}
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Matching reference numbers and full titles from any company
          </Text>
        </Space>
      }
      description={
        <List
          size="small"
          style={{ marginTop: 8 }}
          dataSource={result.matches}
          renderItem={(item) => (
            <List.Item
              style={{ padding: '6px 0', border: 'none' }}
              actions={
                onViewTicket
                  ? [
                      <Button
                        key="view"
                        type="link"
                        size="small"
                        icon={<LinkOutlined />}
                        onClick={() => onViewTicket(item.id, item.type)}
                      >
                        View
                      </Button>,
                    ]
                  : undefined
              }
            >
              <Space direction="vertical" size={2} style={{ flex: 1, minWidth: 0 }}>
                <Space wrap size={4}>
                  <Text strong>{item.reference_no}</Text>
                  {item.company_name ? <Tag color="geekblue">{item.company_name}</Tag> : null}
                  <Tag>{item.type === 'feature' ? 'Feature' : item.type === 'bug' ? 'Bug' : 'Chores'}</Tag>
                  <Tag color={item.match_kind === 'exact' ? 'blue' : 'default'}>
                    {item.match_kind === 'exact' ? 'Exact phrase' : `Similar ${item.match_score}%`}
                  </Tag>
                </Space>
                <Text style={{ display: 'block', wordBreak: 'break-word' }}>{item.title}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {item.status_summary}
                  {item.created_at ? ` · ${formatDateTable(item.created_at)}` : ''}
                </Text>
              </Space>
            </List.Item>
          )}
        />
      }
    />
  )
}
