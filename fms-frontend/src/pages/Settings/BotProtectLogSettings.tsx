import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Table, Tag, Typography, message } from 'antd'
import { SafetyCertificateOutlined, ReloadOutlined } from '@ant-design/icons'
import { botProtectApi, type BotOpenStrike, type BotProtectEvent } from '../../api/botProtect'
import { apiErrorMessage } from '../../utils/apiError'

const { Title, Paragraph, Text } = Typography

function eventTypeColor(t?: string): string {
  const v = (t || '').toLowerCase()
  if (v.includes('deactivat')) return 'red'
  if (v === 'honeypot' || v === 'timing_or_missing') return 'orange'
  if (v === 'bad_ua' || v === 'bad_client') return 'volcano'
  return 'default'
}

export function BotProtectLogSettings() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<BotProtectEvent[]>([])
  const [openStrikes, setOpenStrikes] = useState<BotOpenStrike[]>([])
  const [hint, setHint] = useState<string | undefined>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await botProtectApi.listEvents(100)
      setItems(data.items || [])
      setOpenStrikes(data.open_strikes || [])
      setHint(data.hint)
    } catch (err: unknown) {
      message.error(apiErrorMessage(err, 'Could not load bot protect log.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Card loading={loading} style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <Title level={4} style={{ margin: 0 }}>
          <SafetyCertificateOutlined style={{ marginRight: 8 }} />
          Bot protect log
        </Title>
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      <Paragraph type="secondary" style={{ marginTop: 8 }}>
        Master Admin only. Shows when automation was blocked, which page/API was hit, attempt count, and whether the
        account was deactivated (after 3 bot-check failures).
      </Paragraph>

      {hint && items.length === 0 && (
        <Alert type="info" showIcon style={{ marginBottom: 16 }} message={hint} />
      )}

      <Title level={5}>Open strike counters</Title>
      <Paragraph type="secondary">
        Live counters on this server (reset after idle window or successful login). Limit is usually 3.
      </Paragraph>
      <Table
        size="small"
        rowKey="key"
        pagination={false}
        style={{ marginBottom: 24 }}
        dataSource={openStrikes}
        locale={{ emptyText: 'No open strikes right now.' }}
        columns={[
          { title: 'Type', dataIndex: 'kind', width: 90 },
          { title: 'ID / Email', dataIndex: 'identity', ellipsis: true },
          {
            title: 'Tries',
            dataIndex: 'strike_count',
            width: 100,
            render: (n: number, row) => (
              <Text strong>
                {n}/{row.limit ?? 3}
              </Text>
            ),
          },
          { title: 'Last try', dataIndex: 'last_at', width: 180 },
        ]}
      />

      <Title level={5}>Block / hit history</Title>
      <Table
        size="small"
        rowKey={(r) => r.id || `${r.created_at}-${r.email}-${r.page}`}
        dataSource={items}
        pagination={{ pageSize: 15 }}
        scroll={{ x: 960 }}
        locale={{ emptyText: 'No bot hits logged yet.' }}
        columns={[
          {
            title: 'When',
            dataIndex: 'created_at',
            width: 170,
            render: (v: string) => (v ? new Date(v).toLocaleString() : '—'),
          },
          {
            title: 'Type',
            dataIndex: 'event_type',
            width: 130,
            render: (v: string) => <Tag color={eventTypeColor(v)}>{v || '—'}</Tag>,
          },
          { title: 'Page / API', dataIndex: 'page', width: 180, ellipsis: true },
          { title: 'Email / ID', dataIndex: 'email', width: 180, ellipsis: true, render: (v, r) => v || r.user_id || '—' },
          {
            title: 'Try #',
            dataIndex: 'strike_count',
            width: 70,
            render: (n: number | null | undefined) => (n == null ? '—' : n),
          },
          {
            title: 'Deactivated',
            dataIndex: 'account_deactivated',
            width: 110,
            render: (v: boolean) => (v ? <Tag color="red">Yes</Tag> : 'No'),
          },
          { title: 'IP', dataIndex: 'client_ip', width: 120, ellipsis: true },
          { title: 'Detail', dataIndex: 'detail', ellipsis: true },
        ]}
      />
    </Card>
  )
}
