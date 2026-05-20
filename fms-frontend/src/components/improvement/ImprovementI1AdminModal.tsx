import { useCallback, useEffect, useState } from 'react'
import { Button, Input, Modal, Popconfirm, Select, Table, Tag, message } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  improvementSuggestionsApi,
  type ImprovementSuggestion,
  type ImprovementStatus,
} from '../../api/improvementSuggestions'

interface Props {
  open: boolean
  onClose: () => void
}

export function ImprovementI1AdminModal({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<ImprovementSuggestion[]>([])
  const [savingId, setSavingId] = useState<string | null>(null)
  const [canEdit, setCanEdit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await improvementSuggestionsApi.list()
      setRows(res.data?.data ?? [])
      setCanEdit(!!res.data?.can_edit)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail || 'Could not load I-1 board')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const saveRow = async (
    id: string,
    patch: Partial<{ reference_no: string; suggestion_text: string; status: ImprovementStatus }>,
  ) => {
    setSavingId(id)
    try {
      const res = await improvementSuggestionsApi.update(id, patch)
      const updated = res.data?.data
      if (updated) {
        setRows((prev) => prev.map((r) => (r.id === id ? updated : r)))
      }
      message.success('Saved')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail || 'Save failed')
      await load()
    } finally {
      setSavingId(null)
    }
  }

  const deleteRow = async (id: string) => {
    setSavingId(id)
    try {
      await improvementSuggestionsApi.remove(id)
      setRows((prev) => prev.filter((r) => r.id !== id))
      message.success('Deleted')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail || 'Delete failed')
    } finally {
      setSavingId(null)
    }
  }

  const columns: ColumnsType<ImprovementSuggestion> = [
    {
      title: 'Reference',
      dataIndex: 'reference_no',
      width: 110,
      render: (val: string, record) => (
        <Input
          defaultValue={val}
          disabled={!canEdit || savingId === record.id}
          onBlur={(e) => {
            const next = e.target.value.trim().toUpperCase()
            if (next && next !== val) saveRow(record.id, { reference_no: next })
          }}
          onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
        />
      ),
    },
    {
      title: 'Add your Suggestion & Changes',
      dataIndex: 'suggestion_text',
      render: (val: string, record) => (
        <Input.TextArea
          key={`${record.id}-${record.updated_at}`}
          defaultValue={val}
          autoSize={{ minRows: 2, maxRows: 6 }}
          disabled={!canEdit || savingId === record.id}
          onBlur={(e) => {
            const next = e.target.value.trim()
            if (next && next !== val) saveRow(record.id, { suggestion_text: next })
          }}
        />
      ),
    },
    {
      title: 'User',
      dataIndex: 'user_display_name',
      width: 140,
      render: (val: string) => <span style={{ wordBreak: 'break-word' }}>{val || '—'}</span>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 130,
      render: (val: ImprovementStatus, record) => (
        <Select
          value={val}
          style={{ width: '100%' }}
          disabled={!canEdit || savingId === record.id}
          options={[
            { value: 'not_done', label: 'Not Done' },
            { value: 'done', label: 'Done' },
          ]}
          onChange={(status) => {
            if (status !== val) saveRow(record.id, { status })
          }}
        />
      ),
    },
    ...(canEdit
      ? [
          {
            title: '',
            key: 'actions',
            width: 56,
            render: (_: unknown, record: ImprovementSuggestion) => (
              <Popconfirm
                title={`Delete ${record.reference_no}?`}
                onConfirm={() => deleteRow(record.id)}
                okText="Delete"
                okButtonProps={{ danger: true }}
              >
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  loading={savingId === record.id}
                  aria-label="Delete"
                />
              </Popconfirm>
            ),
          } as const,
        ]
      : []),
  ]

  return (
    <Modal
      title="I - 1 — Improvement board"
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(1100px, 96vw)"
      destroyOnClose
    >
      <p style={{ color: '#64748b', marginBottom: 12 }}>
        Suggestions from the <strong>Improvement</strong> button. Grant <strong>I - 1 → Edit</strong> in Users
        to change rows; <strong>View</strong> only is read-only. User column is never editable.
      </p>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={columns}
        pagination={{ pageSize: 15, showSizeChanger: true }}
        size="small"
        scroll={{ x: 900 }}
      />
      <div style={{ marginTop: 8 }}>
        <Tag color="blue">{rows.length} total</Tag>
        <Tag color="green">{rows.filter((r) => r.status === 'done').length} done</Tag>
        <Tag color="orange">{rows.filter((r) => r.status === 'not_done').length} not done</Tag>
      </div>
    </Modal>
  )
}
