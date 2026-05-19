import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Collapse,
  Input,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  ClockCircleOutlined,
  DeleteOutlined,
  EyeOutlined,
  MailOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import { SkeletonOverlay } from '../../components/common/skeletons'
import {
  escalationEmailsApi,
  type EscalationConfig,
  type EscalationManualTrigger,
  type EscalationSendLog,
  type EscalationStats,
} from '../../api/escalationEmails'
import {
  resolveEscalationCriticalCronUrl,
  resolveEscalationPendingCronUrl,
  resolveEscalationStageCronUrl,
} from '../../api/axios'
import { apiErrorMessage } from '../../utils/apiError'
import type { EmailDeliveryStatus } from '../../api/escalationEmails'

const { Title, Text, Paragraph } = Typography

const glassCard: React.CSSProperties = {
  background: 'linear-gradient(135deg, rgba(15,23,42,0.85) 0%, rgba(30,27,75,0.65) 100%)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(56,189,248,0.25)',
  borderRadius: 16,
  padding: 20,
  marginBottom: 16,
  boxShadow: '0 8px 32px rgba(0,0,0,0.25), 0 0 0 1px rgba(56,189,248,0.08) inset',
}

type ConfigBoxProps = {
  cfg: EscalationConfig
  stats?: EscalationStats
  accent: string
  description: string
  onRefresh: () => void
}

function ConfigBox({ cfg, stats, accent, description, onRefresh }: ConfigBoxProps) {
  const [bulk, setBulk] = useState('')
  const [testTo, setTestTo] = useState('')
  const [adding, setAdding] = useState(false)
  const [sending, setSending] = useState(false)
  const [testing, setTesting] = useState(false)

  const pendingCount = useMemo(() => {
    if (!stats) return 0
    if (cfg.configuration_type === 'pending_timeframe') return stats.timeframe_total
    if (cfg.configuration_type === 'critical_pending') return stats.critical_total
    return stats.stages[cfg.configuration_type] ?? 0
  }, [cfg.configuration_type, stats])

  const onAdd = async () => {
    if (!bulk.trim()) {
      message.warning('Enter email(s)')
      return
    }
    setAdding(true)
    try {
      const res = await escalationEmailsApi.addReceivers(cfg.configuration_type, { bulk })
      message.success(`Added ${res.count} recipient(s)`)
      setBulk('')
      onRefresh()
    } catch (err: unknown) {
      message.error(apiErrorMessage(err, 'Could not add emails'))
    } finally {
      setAdding(false)
    }
  }

  const onToggleConfig = async (checked: boolean) => {
    try {
      await escalationEmailsApi.patchConfig(cfg.configuration_type, { is_enabled: checked })
      onRefresh()
    } catch {
      message.error('Update failed')
    }
  }

  const onToggleRecipient = async (id: string, checked: boolean) => {
    try {
      await escalationEmailsApi.patchRecipient(id, { is_enabled: checked })
      onRefresh()
    } catch {
      message.error('Update failed')
    }
  }

  const onDelete = async (id: string) => {
    try {
      await escalationEmailsApi.deleteReceiver(id)
      onRefresh()
    } catch {
      message.error('Delete failed')
    }
  }

  const onForceSend = async () => {
    setSending(true)
    try {
      const out = await escalationEmailsApi.forceSend(cfg.configuration_type)
      if ((out as { skipped?: boolean }).skipped) {
        message.info((out as { reason?: string }).reason || 'Skipped')
      } else {
        message.success('Escalation email sent')
      }
      onRefresh()
    } catch (err: unknown) {
      message.error(apiErrorMessage(err, 'Send failed'), 10)
    } finally {
      setSending(false)
    }
  }

  const onTest = async () => {
    const to = testTo.trim()
    if (!to) {
      message.warning('Enter test email')
      return
    }
    setTesting(true)
    try {
      await escalationEmailsApi.testEmail(cfg.configuration_type, to)
      message.success('Test email sent')
    } catch (err: unknown) {
      message.error(apiErrorMessage(err, 'Test failed'), 10)
    } finally {
      setTesting(false)
    }
  }

  const onPreview = async () => {
    try {
      const html = await escalationEmailsApi.fetchPreviewHtml(cfg.configuration_type)
      const blob = new Blob([html], { type: 'text/html' })
      window.open(URL.createObjectURL(blob), '_blank', 'noopener,noreferrer')
    } catch {
      message.error('Could not load preview')
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      style={{ ...glassCard, borderColor: `${accent}44` }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        <div>
          <Title level={5} style={{ margin: 0, color: '#e2e8f0' }}>
            {cfg.stage_name}
          </Title>
          <Paragraph type="secondary" style={{ margin: '4px 0 0', maxWidth: 520 }}>
            {description}
          </Paragraph>
        </div>
        <Space wrap>
          <Badge count={pendingCount} overflowCount={999} style={{ backgroundColor: accent }} />
          <Text type="secondary">Enable</Text>
          <Switch checked={cfg.is_enabled} onChange={onToggleConfig} />
        </Space>
      </div>

      {cfg.last_sent_at && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          Last sent: {String(cfg.last_sent_at).replace('T', ' ').slice(0, 19)}
        </Text>
      )}

      <div style={{ marginTop: 12 }}>
        <Text strong style={{ color: '#94a3b8' }}>
          Recipients
        </Text>
        <Space wrap style={{ margin: '8px 0' }}>
          {(cfg.receivers || []).map((r) => (
            <Tag
              key={r.id}
              closable
              onClose={() => onDelete(r.id)}
              color={r.is_enabled ? 'processing' : 'default'}
              style={{ padding: '4px 10px', borderRadius: 999 }}
            >
              <Switch
                size="small"
                checked={r.is_enabled}
                onChange={(c) => onToggleRecipient(r.id, c)}
                style={{ marginRight: 6 }}
              />
              {r.email}
            </Tag>
          ))}
        </Space>
        <Space.Compact style={{ width: '100%', maxWidth: 560 }}>
          <Input
            placeholder="Add emails (comma-separated)"
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            onPressEnter={onAdd}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={onAdd} loading={adding}>
            Add
          </Button>
        </Space.Compact>
      </div>

      <Space wrap style={{ marginTop: 16 }}>
        <Button type="primary" icon={<ThunderboltOutlined />} loading={sending} onClick={onForceSend}>
          Force Send Now
        </Button>
        <Button icon={<EyeOutlined />} onClick={onPreview}>
          Preview template
        </Button>
        <Input
          style={{ width: 200 }}
          placeholder="Test email"
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
        />
        <Button icon={<SendOutlined />} loading={testing} onClick={onTest}>
          Send test
        </Button>
      </Space>
    </motion.div>
  )
}

export function EscalationEmailSettings() {
  const [loading, setLoading] = useState(true)
  const [configs, setConfigs] = useState<EscalationConfig[]>([])
  const [stats, setStats] = useState<EscalationStats | null>(null)
  const [logs, setLogs] = useState<EscalationSendLog[]>([])
  const [triggers, setTriggers] = useState<EscalationManualTrigger[]>([])
  const [logFilter, setLogFilter] = useState('')
  const [retrying, setRetrying] = useState<string | null>(null)
  const [emailDelivery, setEmailDelivery] = useState<EmailDeliveryStatus | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      await escalationEmailsApi.ping()
      const [cfgRes, logRes, trigRes] = await Promise.all([
        escalationEmailsApi.getConfig(),
        escalationEmailsApi.listLogs(40),
        escalationEmailsApi.listManualTriggers(20),
      ])
      setConfigs(cfgRes.items || [])
      setStats(cfgRes.stats)
      setEmailDelivery(cfgRes.email_delivery ?? null)
      setLogs(logRes.items || [])
      setTriggers(trigRes.items || [])
    } catch (err: unknown) {
      const d = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(apiErrorMessage(err, 'Run database/ESCALATION_EMAIL_SYSTEM.sql on Supabase.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const byType = useMemo(() => {
    const m: Record<string, EscalationConfig> = {}
    configs.forEach((c) => {
      m[c.configuration_type] = c
    })
    return m
  }, [configs])

  const filteredLogs = useMemo(() => {
    const q = logFilter.trim().toLowerCase()
    if (!q) return logs
    return logs.filter(
      (l) =>
        l.recipient.toLowerCase().includes(q) ||
        l.configuration_type.toLowerCase().includes(q) ||
        (l.status || '').toLowerCase().includes(q)
    )
  }, [logs, logFilter])

  const onRetry = async (logId: string) => {
    setRetrying(logId)
    try {
      await escalationEmailsApi.retryLog(logId)
      message.success('Retry sent')
      load()
    } catch {
      message.error('Retry failed')
    } finally {
      setRetrying(null)
    }
  }

  const pendingCron = resolveEscalationPendingCronUrl()
  const criticalCron = resolveEscalationCriticalCronUrl()
  const stageCron = resolveEscalationStageCronUrl()

  return (
    <SkeletonOverlay loading={loading} rows={14} minHeight={400}>
      <motion.div style={{ marginTop: 8 }}>
        <Title level={4}>
          <MailOutlined style={{ marginRight: 8, color: '#38bdf8' }} />
          Advanced Pending Escalation &amp; Approval Email Configuration
        </Title>
        <Paragraph type="secondary">
          Automated pending escalation for Chores, Bugs, and Staging. Configure recipients per flow, use external cron jobs on
          production, or force-send instantly from here.
        </Paragraph>

        {emailDelivery && !emailDelivery.credentials_loaded && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="Email not configured on production backend"
            description={
              <span>
                Set <Text code>POSTMARK_SMTP_TOKEN</Text> and <Text code>SMTP_FROM_EMAIL</Text> (verified sender in Postmark) on
                Render, then redeploy. Mode: {emailDelivery.mode}, transport: {emailDelivery.transport}.
              </span>
            }
          />
        )}
        {emailDelivery?.credentials_loaded && emailDelivery.mode === 'log' && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="EMAIL_MODE=log — emails are not actually sent"
            description='Set EMAIL_MODE=postmark on Render (or remove EMAIL_MODE) and redeploy.'
          />
        )}
        {emailDelivery?.credentials_loaded && emailDelivery.mode !== 'log' && (
          <Alert
            type="success"
            showIcon
            style={{ marginBottom: 16 }}
            message={`Email ready (${emailDelivery.transport})`}
            description={`From: ${emailDelivery.from_email || '—'} · Postmark API + SMTP fallback`}
          />
        )}

        {stats && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              ...glassCard,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 12,
            }}
          >
            <div>
              <Text type="secondary">24–48hr</Text>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#eab308' }}>{stats.timeframe['24_48'] ?? 0}</div>
            </div>
            <div>
              <Text type="secondary">48–72hr</Text>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#f97316' }}>{stats.timeframe['48_72'] ?? 0}</div>
            </div>
            <div>
              <Text type="secondary">72hr+</Text>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#ef4444' }}>{stats.timeframe['72_plus'] ?? 0}</div>
            </div>
            <div>
              <Text type="secondary">Critical</Text>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#f87171' }}>{stats.critical_total}</div>
            </div>
          </motion.div>
        )}

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="External cron (production Render backend)"
          description={
            <div style={{ fontSize: 13 }}>
              <div>
                <Text strong>POST</Text> <Text code copyable>{pendingCron}</Text> — timeframe report (daily morning)
              </div>
              <div style={{ marginTop: 6 }}>
                <Text strong>POST</Text> <Text code copyable>{criticalCron}</Text> — critical 72hr+ (optional every 6hr)
              </div>
              <div style={{ marginTop: 6 }}>
                <Text strong>POST</Text> <Text code copyable>{stageCron}</Text> — stage 2 / 3 / 4 mails
              </div>
              <div style={{ marginTop: 8 }}>
                Auth: <Text code>Authorization: Bearer &lt;ESCALATION_CRON_SECRET&gt;</Text> or header{' '}
                <Text code>X-Cron-Secret</Text>
              </div>
            </div>
          }
        />

        <Collapse
          defaultActiveKey={['pending', 'stage', 'logs']}
          items={[
            {
              key: 'pending',
              label: (
                <span>
                  <ClockCircleOutlined style={{ marginRight: 8 }} />
                  Pending Escalation Email Configuration
                </span>
              ),
              children: (
                <>
                  <Title level={5}>Pending Timeframe Escalation</Title>
                  {byType.pending_timeframe && (
                    <ConfigBox
                      cfg={byType.pending_timeframe}
                      stats={stats ?? undefined}
                      accent="#38bdf8"
                      description="Chores, Bugs, Stage 2 pending, and Staging — grouped into 24–48hr, 48–72hr, and 72hr+ sections."
                      onRefresh={load}
                    />
                  )}
                  <Title level={5} style={{ marginTop: 24 }}>
                    <WarningOutlined style={{ color: '#ef4444', marginRight: 8 }} />
                    Critical Pending Escalation
                  </Title>
                  {byType.critical_pending && (
                    <ConfigBox
                      cfg={byType.critical_pending}
                      stats={stats ?? undefined}
                      accent="#ef4444"
                      description="Only tickets pending 72hr+ — red alert layout with Chores, Bugs, and Staging sections."
                      onRefresh={load}
                    />
                  )}
                </>
              ),
            },
            {
              key: 'stage',
              label: 'Stage Wise Pending Notification Configuration',
              children: (
                <>
                  {(['stage_2', 'stage_3', 'stage_4'] as const).map((key, i) => {
                    const accents = ['#eab308', '#f97316', '#ef4444']
                    const labels = [
                      'Stage 2 pending tickets',
                      'Stage 3 pending tickets',
                      'Stage 4 pending tickets',
                    ]
                    const cfg = byType[key]
                    if (!cfg) return null
                    return (
                      <ConfigBox
                        key={key}
                        cfg={cfg}
                        stats={stats ?? undefined}
                        accent={accents[i]}
                        description={labels[i]}
                        onRefresh={load}
                      />
                    )
                  })}
                </>
              ),
            },
            {
              key: 'logs',
              label: 'Delivery logs & activity',
              children: (
                <>
                  <Space style={{ marginBottom: 12 }}>
                    <Button icon={<ReloadOutlined />} onClick={load}>
                      Refresh
                    </Button>
                    <Input
                      placeholder="Search logs by email or type"
                      value={logFilter}
                      onChange={(e) => setLogFilter(e.target.value)}
                      style={{ width: 280 }}
                      allowClear
                    />
                  </Space>
                  <Table<EscalationSendLog>
                    size="small"
                    rowKey="id"
                    dataSource={filteredLogs}
                    pagination={{ pageSize: 8 }}
                    scroll={{ x: true }}
                    columns={[
                      {
                        title: 'Sent',
                        dataIndex: 'sent_at',
                        width: 160,
                        render: (t) => (t ? String(t).replace('T', ' ').slice(0, 19) : '—'),
                      },
                      { title: 'Type', dataIndex: 'configuration_type', width: 140 },
                      { title: 'Recipient', dataIndex: 'recipient', ellipsis: true },
                      { title: '#', dataIndex: 'total_pending', width: 50 },
                      {
                        title: 'Status',
                        dataIndex: 'status',
                        width: 80,
                        render: (s) => (
                          <Tag color={s === 'sent' ? 'success' : 'error'}>{s}</Tag>
                        ),
                      },
                      {
                        title: '',
                        width: 80,
                        render: (_, r) =>
                          r.status === 'failed' ? (
                            <Button
                              size="small"
                              loading={retrying === r.id}
                              onClick={() => onRetry(r.id)}
                            >
                              Retry
                            </Button>
                          ) : null,
                      },
                    ]}
                  />
                  <Title level={5} style={{ marginTop: 20 }}>
                    Manual / cron trigger timeline
                  </Title>
                  <Table<EscalationManualTrigger>
                    size="small"
                    rowKey="id"
                    dataSource={triggers}
                    pagination={{ pageSize: 6 }}
                    columns={[
                      {
                        title: 'When',
                        dataIndex: 'created_at',
                        render: (t) => (t ? String(t).replace('T', ' ').slice(0, 19) : '—'),
                      },
                      { title: 'Type', dataIndex: 'configuration_type' },
                      { title: 'Source', dataIndex: 'trigger_source' },
                      {
                        title: 'Force',
                        dataIndex: 'force_bypass',
                        render: (f) => (f ? 'Yes' : 'No'),
                      },
                    ]}
                  />
                </>
              ),
            },
          ]}
        />
      </div>
    </SkeletonOverlay>
  )
}
