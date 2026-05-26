import { useState, useEffect, useCallback } from 'react'
import {
  Form,
  Input,
  Button,
  Card,
  Typography,
  message,
  Space,
  Avatar,
  Divider,
  Table,
  Switch,
  Alert,
} from 'antd'
import { UserOutlined, MailOutlined, PlusOutlined, DeleteOutlined, SendOutlined } from '@ant-design/icons'
import { useAuth } from '../../hooks/useAuth'
import { useRole } from '../../hooks/useRole'
import { usersApi } from '../../api/users'
import { getInitials } from '../../utils/helpers'
import { apiErrorMessage } from '../../utils/apiError'
import { PrintExport } from '../../components/common/PrintExport'
import {
  featureApprovalRemindersApi,
  type FeatureApprovalRecipient,
  type FeatureApprovalLog,
  type ApprovalPublicUrlConfig,
} from '../../api/featureApprovalReminders'
import { resolveFeatureApprovalCronRunUrl } from '../../api/axios'
import { SkeletonOverlay } from '../../components/common/skeletons'
import { EscalationEmailSettings } from './EscalationEmailSettings'
import { ChecklistDelegationEmailSettings } from './ChecklistDelegationEmailSettings'

const { Title, Paragraph, Text } = Typography

export const SettingsPage = () => {
  const { user, refreshUser } = useAuth()
  const { canAccessSettings } = useRole()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)

  const [faLoading, setFaLoading] = useState(false)
  const [recipients, setRecipients] = useState<FeatureApprovalRecipient[]>([])
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [testLoading, setTestLoading] = useState(false)
  const [runLoading, setRunLoading] = useState(false)
  const [logs, setLogs] = useState<FeatureApprovalLog[]>([])
  const [urlConfig, setUrlConfig] = useState<ApprovalPublicUrlConfig | null>(null)

  const loadFeatureApproval = useCallback(async () => {
    if (!canAccessSettings) return
    setFaLoading(true)
    try {
      await featureApprovalRemindersApi.ping()
      const [recRes, logRes, urlCfg] = await Promise.all([
        featureApprovalRemindersApi.listRecipients(),
        featureApprovalRemindersApi.listLogs(25),
        featureApprovalRemindersApi.getPublicUrlConfig().catch(() => null),
      ])
      setRecipients(recRes.items || [])
      setLogs(logRes.items || [])
      setUrlConfig(urlCfg)
    } catch (err: unknown) {
      const d = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(typeof d === 'string' ? d : 'Could not load Feature Approval settings. Run SQL migration on Supabase.')
    } finally {
      setFaLoading(false)
    }
  }, [canAccessSettings])

  useEffect(() => {
    if (user) {
      form.setFieldsValue({
        full_name: user.full_name,
        email: user.email,
      })
    }
  }, [user, form])

  useEffect(() => {
    loadFeatureApproval()
  }, [loadFeatureApproval])

  const onFinish = async (values: { full_name: string }) => {
    if (!user) return
    setLoading(true)
    try {
      const response = await usersApi.update(user.id, values)
      if (response.data) {
        refreshUser(response.data)
        message.success('Profile updated successfully')
      }
    } catch {
      message.error('Failed to update profile')
    } finally {
      setLoading(false)
    }
  }

  const onAddRecipient = async () => {
    const email = newEmail.trim()
    if (!email) {
      message.warning('Enter an email')
      return
    }
    setAddLoading(true)
    try {
      await featureApprovalRemindersApi.addRecipient(email, newName.trim())
      message.success('Recipient added')
      setNewEmail('')
      setNewName('')
      loadFeatureApproval()
    } catch (err: unknown) {
      const d = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(typeof d === 'string' ? d : 'Could not add recipient')
    } finally {
      setAddLoading(false)
    }
  }

  const onToggleRecipient = async (r: FeatureApprovalRecipient, checked: boolean) => {
    try {
      await featureApprovalRemindersApi.patchRecipient(r.id, { is_enabled: checked })
      setRecipients((prev) => prev.map((x) => (x.id === r.id ? { ...x, is_enabled: checked } : x)))
    } catch {
      message.error('Could not update recipient')
      loadFeatureApproval()
    }
  }

  const onDeleteRecipient = async (id: string) => {
    try {
      await featureApprovalRemindersApi.deleteRecipient(id)
      message.success('Removed')
      loadFeatureApproval()
    } catch {
      message.error('Could not remove recipient')
    }
  }

  const onTestEmail = async () => {
    const to = testTo.trim() || user?.email || ''
    if (!to) {
      message.warning('Enter a test email address')
      return
    }
    setTestLoading(true)
    try {
      await featureApprovalRemindersApi.testEmail(to)
      message.success('Test email sent — check inbox')
    } catch (err: unknown) {
      message.error(apiErrorMessage(err, 'Test send failed'), 10)
    } finally {
      setTestLoading(false)
    }
  }

  const onRunNow = async () => {
    setRunLoading(true)
    try {
      const out = await featureApprovalRemindersApi.run(true) as {
        skipped?: boolean
        reason?: string
        ok?: boolean
        error?: string
        pending?: number
        sent_ok?: number
        failed?: number
        recipients_attempted?: number
        status?: string
      }
      if (out.status === 'accepted') {
        message.success(
          (out.message as string) || 'Reminder sending started — check Recent send log in 10–30 seconds.',
          6
        )
        window.setTimeout(() => loadFeatureApproval(), 12000)
      } else if (out.skipped) {
        message.info(`Skipped: ${out.reason || '—'}`)
      } else if (out.ok === false) {
        message.error(String(out.error || 'Run failed'), 10)
      } else {
        message.success(
          `Reminder run: pending ${out.pending ?? '—'}, sent ${out.sent_ok ?? 0}/${out.recipients_attempted ?? 0}` +
            (out.failed ? `, failed ${out.failed}` : '')
        )
      }
      loadFeatureApproval()
    } catch (err: unknown) {
      message.error(apiErrorMessage(err, 'Run failed'), 10)
    } finally {
      setRunLoading(false)
    }
  }

  if (!user) return null

  const cronRunUrl = resolveFeatureApprovalCronRunUrl()

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <Title level={2} className="page-main-heading" style={{ margin: 0 }}>
          Settings
        </Title>
        <PrintExport pageTitle="Settings" />
      </div>
      <Card>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div>
            <Title level={4}>Profile</Title>
            <Space>
              <Avatar size={64} icon={<UserOutlined />} src={user.avatar_url}>
                {!user.avatar_url && getInitials(user.full_name)}
              </Avatar>
              <div>
                <div style={{ fontWeight: 'bold' }}>{user.full_name}</div>
                <div style={{ color: '#999' }}>{user.email}</div>
                <div style={{ color: '#999' }}>Role: {user.role.toUpperCase()}</div>
              </div>
            </Space>
          </div>

          <Form form={form} layout="vertical" onFinish={onFinish} style={{ maxWidth: 500 }}>
            <Form.Item name="full_name" label="Full Name" rules={[{ required: true, message: 'Please enter your full name' }]}>
              <Input />
            </Form.Item>

            <Form.Item name="email" label="Email">
              <Input disabled />
            </Form.Item>

            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading}>
                Update Profile
              </Button>
            </Form.Item>
          </Form>

          {canAccessSettings && (
            <>
              <Divider />
              <ChecklistDelegationEmailSettings />
              <Divider />
              <SkeletonOverlay loading={faLoading} rows={10} minHeight={200}>
                <div>
                  <Title level={4}>
                    <MailOutlined style={{ marginRight: 8 }} />
                    Feature Approval Email Configuration
                  </Title>
                  <Paragraph type="secondary">
                    When Feature tickets are pending approval, each cron run sends <Text strong>one grouped HTML reminder</Text> to enabled
                    recipients below. Set the send time on <Text strong>cron-job.org</Text> (see cron URL below). No emails on{' '}
                    <Text strong>Sundays</Text> or dates in Checklist → Upload Holiday List.
                  </Paragraph>

                  {urlConfig && !urlConfig.email_links_ok && (
                    <Alert
                      type="error"
                      showIcon
                      style={{ marginBottom: 16, maxWidth: 900 }}
                      message="Approve/Reject email links point to localhost"
                      description={
                        <span>
                          Current base: <Text code>{urlConfig.public_api_base}</Text>. On Render set{' '}
                          <Text code>PUBLIC_API_URL=https://ip-internal-manage-software.onrender.com</Text>, redeploy backend, then send a
                          new reminder (old emails still have old links).
                        </span>
                      }
                    />
                  )}
                  {urlConfig?.email_links_ok && (
                    <Alert
                      type="success"
                      showIcon
                      style={{ marginBottom: 16, maxWidth: 900 }}
                      message="Approve/Reject links use production API"
                      description={
                        <span>
                          Email buttons open: <Text code copyable>{urlConfig.public_api_base}/approval/email-action</Text>
                        </span>
                      }
                    />
                  )}

                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16, maxWidth: 900 }}
                    message="External scheduler — POST your production API"
                    description={
                      <div style={{ fontSize: 13 }}>
                        <div style={{ marginBottom: 8 }}>
                          <Text type="secondary">
                            URL is your <Text strong>FastAPI backend</Text> (from <Text code>VITE_API_BASE_URL</Text> /{' '}
                            <Text code>.env.production</Text>), not the website or Vite port. Production example:{' '}
                            <Text code>https://your-api.onrender.com/feature-approval-reminders/run</Text>
                          </Text>
                        </div>
                        <div>
                          <Text strong>POST</Text> <Text code copyable>{cronRunUrl}</Text>
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <Text strong>GET or POST</Text> with header <Text code>X-Cron-Secret</Text> (value must match{' '}
                          <Text code>FEATURE_APPROVAL_CRON_SECRET</Text> on Render). cron-job.org can use <Text strong>GET</Text>. The API
                          responds immediately; sending continues in the background.
                        </div>
                      </div>
                    }
                  />

                  <Title level={5}>Recipients</Title>
                  <Space wrap style={{ marginBottom: 12 }} align="start">
                    <Input style={{ width: 260 }} placeholder="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                    <Input style={{ width: 200 }} placeholder="Name (optional)" value={newName} onChange={(e) => setNewName(e.target.value)} />
                    <Button type="primary" icon={<PlusOutlined />} onClick={onAddRecipient} loading={addLoading}>
                      Add
                    </Button>
                  </Space>

                  <Table<FeatureApprovalRecipient>
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={recipients}
                    columns={[
                      { title: 'Email', dataIndex: 'email', key: 'email' },
                      { title: 'Name', dataIndex: 'name', key: 'name', render: (n) => n || '—' },
                      {
                        title: 'Enabled',
                        key: 'is_enabled',
                        width: 100,
                        render: (_, r) => (
                          <Switch checked={r.is_enabled} onChange={(c) => onToggleRecipient(r, c)} />
                        ),
                      },
                      {
                        title: '',
                        key: 'actions',
                        width: 72,
                        render: (_, r) => (
                          <Button
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            aria-label="Delete"
                            onClick={() => onDeleteRecipient(r.id)}
                          />
                        ),
                      },
                    ]}
                  />

                  <Divider />
                  <Title level={5}>Test email &amp; force send</Title>
                  <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                    <Text strong>Force send</Text> runs the same job from the browser (admin session). It bypasses the{' '}
                    <Text strong>once-per-day</Text> guard used by external cron. The server starts sending in the
                    background — wait ~15s and check <Text strong>Recent send log</Text> (not an instant toast if many
                    tickets). It does not replace your external scheduler.
                  </Paragraph>
                  <Space wrap style={{ marginBottom: 12 }} align="start">
                    <Input style={{ width: 280 }} placeholder="Test email address" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                    <Button icon={<SendOutlined />} onClick={onTestEmail} loading={testLoading}>
                      Send test email
                    </Button>
                    <Button type="primary" onClick={onRunNow} loading={runLoading}>
                      Force send reminder now
                    </Button>
                  </Space>
                  <Paragraph type="secondary">
                    Test email uses the sample row in the template. Force send only delivers if there are pending Feature tickets and at least
                    one enabled recipient.
                  </Paragraph>

                  <Title level={5} style={{ marginTop: 8 }}>
                    Recent send log
                  </Title>
                  <Table<FeatureApprovalLog>
                    size="small"
                    rowKey="id"
                    pagination={{ pageSize: 8 }}
                    dataSource={logs}
                    scroll={{ x: true }}
                    columns={[
                      { title: 'Sent at', dataIndex: 'sent_at', key: 'sent_at', width: 180, render: (t) => (t ? String(t).replace('T', ' ').slice(0, 19) : '—') },
                      { title: 'Recipient', dataIndex: 'recipient', key: 'recipient', ellipsis: true },
                      { title: 'Pending #', dataIndex: 'total_pending', key: 'total_pending', width: 90 },
                      { title: 'Status', dataIndex: 'status', key: 'status', width: 80 },
                      { title: 'Error', dataIndex: 'error_message', key: 'error_message', ellipsis: true, render: (e) => e || '—' },
                    ]}
                  />
                </div>
              </SkeletonOverlay>

              <Divider />
              <EscalationEmailSettings />
            </>
          )}
        </Space>
      </Card>
    </div>
  )
}
