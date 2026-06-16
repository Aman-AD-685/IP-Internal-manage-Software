import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Form, Input, Modal, Switch, Table, Typography, message } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import {
  dispatchSystemLockChanged,
  systemLockApi,
  type SystemLockAuditRow,
  type SystemLockStatus,
} from '../../api/systemLock'
import { apiErrorMessage } from '../../utils/apiError'

const { Title, Paragraph, Text } = Typography

export function SystemControlSettings() {
  const [status, setStatus] = useState<SystemLockStatus | null>(null)
  const [audit, setAudit] = useState<SystemLockAuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [reasonOpen, setReasonOpen] = useState(false)
  const [pendingLock, setPendingLock] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<{ reason: string }>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [st, logs] = await Promise.all([systemLockApi.getStatus(), systemLockApi.listAudit(25)])
      setStatus(st)
      setAudit(logs)
    } catch (err: unknown) {
      message.error(apiErrorMessage(err, 'Could not load system lock settings. Run database/SYSTEM_LOCK.sql in Supabase.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onToggle = (checked: boolean) => {
    if (checked) {
      setPendingLock(true)
      setReasonOpen(true)
      form.resetFields()
      return
    }
    Modal.confirm({
      title: 'Disable system access lock?',
      content: 'All Users and Admins will regain access immediately.',
      okText: 'Unlock system',
      onOk: async () => {
        setSubmitting(true)
        try {
          const data = await systemLockApi.unlock()
          setStatus(data)
          dispatchSystemLockChanged(data)
          message.success('System unlocked — all users can access the software again.')
          await load()
        } catch (err: unknown) {
          message.error(apiErrorMessage(err, 'Could not unlock system.'))
        } finally {
          setSubmitting(false)
        }
      },
    })
  }

  const confirmLock = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      const data = await systemLockApi.lock(values.reason.trim())
      setStatus(data)
      setReasonOpen(false)
      setPendingLock(false)
      dispatchSystemLockChanged(data)
      message.success('System locked — all Users and Admins are blocked until you unlock.')
      await load()
    } catch (err: unknown) {
      if ((err as { errorFields?: unknown })?.errorFields) return
      message.error(apiErrorMessage(err, 'Could not enable system lock.'))
    } finally {
      setSubmitting(false)
    }
  }

  const cancelLock = () => {
    setReasonOpen(false)
    setPendingLock(false)
    form.resetFields()
  }

  const locked = Boolean(status?.is_locked)

  return (
    <Card loading={loading} style={{ maxWidth: 900 }}>
      <Title level={4}>
        <LockOutlined style={{ marginRight: 8 }} />
        System Control
      </Title>
      <Paragraph type="secondary">
        Master Admin only. When enabled, <Text strong>all User and Admin accounts</Text> lose access to every module.
        They see your lock reason in a popup. You keep full access.
      </Paragraph>

      <Alert
        type={locked ? 'error' : 'info'}
        showIcon
        style={{ marginBottom: 20 }}
        message={locked ? 'System access lock is ON' : 'System access lock is OFF'}
        description={
          locked ? (
            <span>
              Reason: <Text strong>{status?.reason || '—'}</Text>
              <br />
              <Text type="secondary">
                You (Master Admin) still have full access. All Admin and User accounts are blocked until you turn this
                off.
              </Text>
            </span>
          ) : (
            'Users and Admins can use the software normally.'
          )
        }
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Text strong>System Access Lock</Text>
        <Switch
          checked={locked || pendingLock}
          loading={submitting}
          onChange={onToggle}
          checkedChildren="ON"
          unCheckedChildren="OFF"
        />
      </div>

      <Title level={5} style={{ marginTop: 8 }}>
        Audit log
      </Title>
      <Table
        size="small"
        rowKey="id"
        pagination={{ pageSize: 8, hideOnSinglePage: true }}
        dataSource={audit}
        columns={[
          { title: 'When', dataIndex: 'created_at', width: 180, render: (v: string) => (v ? new Date(v).toLocaleString() : '—') },
          { title: 'Action', dataIndex: 'action', width: 200 },
          { title: 'By', dataIndex: 'performer_email', ellipsis: true },
          { title: 'Reason', dataIndex: 'reason', ellipsis: true },
        ]}
      />

      <Modal
        title="Confirm system lock"
        open={reasonOpen}
        onCancel={cancelLock}
        closable={!submitting}
        maskClosable={false}
        footer={[
          <Button key="cancel" onClick={cancelLock} disabled={submitting}>
            Cancel
          </Button>,
          <Button key="ok" type="primary" danger loading={submitting} onClick={() => void confirmLock()}>
            Confirm Lock
          </Button>,
        ]}
      >
        <Paragraph>Enter a reason (minimum 10 characters). All Users and Admins will see this message.</Paragraph>
        <Form form={form} layout="vertical">
          <Form.Item
            name="reason"
            label="Reason"
            rules={[
              { required: true, message: 'Reason is required' },
              { min: 10, message: 'At least 10 characters' },
            ]}
          >
            <Input.TextArea rows={4} maxLength={2000} placeholder="e.g. Scheduled maintenance until 6 PM IST" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
