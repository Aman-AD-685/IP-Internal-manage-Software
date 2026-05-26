import { useCallback, useEffect, useState } from 'react'
import { Modal, Table, Button, Tag, Typography, message, Space } from 'antd'
import { checklistApi, type ChecklistNaTask } from '../../api/checklist'
import { useAuth } from '../../hooks/useAuth'

const { Text } = Typography

interface ChecklistNaModalProps {
  open: boolean
  onClose: () => void
  userId: string | undefined
  doerLabel?: string
  onMarked?: () => void
}

export function ChecklistNaModal({ open, onClose, userId, doerLabel, onMarked }: ChecklistNaModalProps) {
  const { user } = useAuth()
  const [tasks, setTasks] = useState<ChecklistNaTask[]>([])
  const [loading, setLoading] = useState(false)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [displayDoer, setDisplayDoer] = useState('')

  const load = useCallback(() => {
    if (!userId) return
    setLoading(true)
    checklistApi
      .getNaActive(userId)
      .then((res) => {
        setTasks(res.tasks ?? [])
        setDisplayDoer(res.doer_name || doerLabel || '')
      })
      .catch((e: { response?: { data?: { detail?: string } } }) => {
        message.error(e?.response?.data?.detail || 'Failed to load active checklists')
        setTasks([])
      })
      .finally(() => setLoading(false))
  }, [userId, doerLabel])

  useEffect(() => {
    if (open && userId) load()
  }, [open, userId, load])

  const canMark = (row: ChecklistNaTask) => {
    if (!user?.id) return false
    return row.doer_id === user.id || user.role === 'admin' || user.role === 'master_admin'
  }

  const handleMarkNa = (row: ChecklistNaTask) => {
    Modal.confirm({
      title: 'Mark whole task NA',
      content: (
        <span>
          Mark <strong>{row.reference_no || row.task_name}</strong> as NA? All dates (today, overdue, and
          upcoming) for this checklist will be removed and completion data deleted.
        </span>
      ),
      okText: 'Mark NA',
      okButtonProps: { danger: true },
      onOk: async () => {
        setMarkingId(row.task_id)
        try {
          const res = await checklistApi.markTaskNa(row.task_id)
          message.success(`Marked NA: ${res.reference_no || row.reference_no || row.task_name} — task fully stopped`)
          load()
          onMarked?.()
        } catch (e: unknown) {
          const err = e as { response?: { data?: { detail?: string } } }
          message.error(err?.response?.data?.detail || 'Failed to mark NA')
        } finally {
          setMarkingId(null)
        }
      },
    })
  }

  const statusTags = (r: ChecklistNaTask) => (
    <Space size={4} wrap>
      {r.has_today ? <Tag color="blue">Today</Tag> : null}
      {r.has_overdue ? <Tag color="orange">Overdue</Tag> : null}
      {r.has_upcoming ? <Tag color="default">Upcoming</Tag> : null}
    </Space>
  )

  const columns = [
    {
      title: 'Reference No',
      dataIndex: 'reference_no',
      key: 'reference_no',
      width: 120,
      render: (v: string) => v || '—',
    },
    {
      title: 'Task',
      dataIndex: 'task_name',
      key: 'task_name',
    },
    {
      title: 'Department',
      dataIndex: 'department',
      key: 'department',
      width: 160,
    },
    {
      title: 'Pending dates',
      key: 'pending',
      width: 100,
      render: (_: unknown, r: ChecklistNaTask) => r.pending_count ?? 0,
    },
    {
      title: 'Status',
      key: 'status',
      width: 180,
      render: (_: unknown, r: ChecklistNaTask) => statusTags(r),
    },
    {
      title: 'NA',
      key: 'action',
      width: 88,
      render: (_: unknown, r: ChecklistNaTask) =>
        canMark(r) ? (
          <Button
            size="small"
            danger
            loading={markingId === r.task_id}
            onClick={() => handleMarkNa(r)}
          >
            NA
          </Button>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
  ]

  return (
    <Modal
      title="NA_Checklist"
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
      width={820}
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }} size={4}>
        <Text type="secondary">
          One <strong>NA</strong> button per checklist task for{' '}
          <Text strong>{displayDoer || 'selected user'}</Text>. Marking NA stops the whole task — no dates
          remain in Task List.
        </Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {tasks.length} active task{tasks.length === 1 ? '' : 's'} · user-wise
        </Text>
      </Space>
      <Table
        dataSource={tasks}
        columns={columns}
        rowKey="task_id"
        loading={loading}
        pagination={tasks.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
        size="small"
        locale={{ emptyText: 'No active checklist tasks' }}
      />
    </Modal>
  )
}
