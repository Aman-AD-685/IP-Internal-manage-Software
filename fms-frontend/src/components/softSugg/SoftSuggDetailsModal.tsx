import { useCallback, useEffect, useState } from 'react'
import { Button, Input, Modal, Popconfirm, Select, Table, Tag, message } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  softSuggestionsApi,
  type SoftSuggestion,
  type SoftSuggestionType,
} from '../../api/softSuggestions'

interface Props {
  open: boolean
  onClose: () => void
  onMoveToSoft: (row: SoftSuggestion) => void
}

export function SoftSuggDetailsModal({ open, onClose, onMoveToSoft }: Props) {
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<SoftSuggestion[]>([])
  const [canEditAll, setCanEditAll] = useState(false)
  const [canEditMove, setCanEditMove] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [pages, setPages] = useState<{ id: string; name: string }[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [listRes, meRes] = await Promise.all([
        softSuggestionsApi.list(),
        softSuggestionsApi.me().catch(() => null),
      ])
      setRows(listRes.data?.data ?? [])
      setCanEditAll(!!listRes.data?.can_edit_all)
      setCanEditMove(!!listRes.data?.can_edit_move)
      setPages(meRes?.data?.pages ?? [])
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail || 'Could not load')
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
    patch: Partial<{
      reference_no: string
      suggestion_text: string
      attach_link: string
      page_id: string
      ticket_type: SoftSuggestionType
    }>,
  ) => {
    setSavingId(id)
    try {
      const res = await softSuggestionsApi.update(id, patch)
      if (res.data?.data) {
        setRows((prev) => prev.map((r) => (r.id === id ? res.data!.data : r)))
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
      await softSuggestionsApi.remove(id)
      setRows((prev) => prev.filter((r) => r.id !== id))
      message.success('Deleted')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail || 'Delete failed')
    } finally {
      setSavingId(null)
    }
  }

  const columns: ColumnsType<SoftSuggestion> = [
    {
      title: 'Reference',
      dataIndex: 'reference_no',
      width: 96,
      fixed: 'left',
      render: (val: string, record) =>
        canEditAll ? (
          <Input
            defaultValue={val}
            disabled={savingId === record.id}
            onBlur={(e) => {
              const next = e.target.value.trim().toUpperCase()
              if (next && next !== val) saveRow(record.id, { reference_no: next })
            }}
          />
        ) : (
          val
        ),
    },
    {
      title: 'Suggestions',
      dataIndex: 'suggestion_text',
      width: 200,
      render: (val: string, record) =>
        canEditAll ? (
          <Input.TextArea
            key={`${record.id}-${record.updated_at}`}
            defaultValue={val}
            autoSize={{ minRows: 2, maxRows: 4 }}
            disabled={savingId === record.id}
            onBlur={(e) => {
              const next = e.target.value.trim()
              if (next && next !== val) saveRow(record.id, { suggestion_text: next })
            }}
          />
        ) : (
          <span style={{ whiteSpace: 'pre-wrap' }}>{val}</span>
        ),
    },
    {
      title: 'Attach Link',
      dataIndex: 'attach_link',
      width: 140,
      render: (val: string | null, record) =>
        canEditAll ? (
          <Input
            defaultValue={val || ''}
            disabled={savingId === record.id}
            onBlur={(e) => {
              const next = e.target.value.trim()
              if (next !== (val || '')) saveRow(record.id, { attach_link: next })
            }}
          />
        ) : val ? (
          <a href={val} target="_blank" rel="noreferrer">
            Link
          </a>
        ) : (
          '—'
        ),
    },
    {
      title: 'Page',
      dataIndex: 'page_name',
      width: 120,
      render: (val: string | null, record) =>
        canEditAll ? (
          <Select
            defaultValue={record.page_id || undefined}
            style={{ width: '100%' }}
            showSearch
            optionFilterProp="label"
            options={pages.map((p) => ({ value: p.id, label: p.name }))}
            disabled={savingId === record.id}
            onChange={(page_id) => {
              if (page_id !== record.page_id) saveRow(record.id, { page_id })
            }}
          />
        ) : (
          val || '—'
        ),
    },
    {
      title: 'Type',
      dataIndex: 'ticket_type',
      width: 100,
      render: (val: SoftSuggestionType, record) =>
        canEditAll ? (
          <Select
            defaultValue={val}
            style={{ width: '100%' }}
            disabled={savingId === record.id}
            options={[
              { value: 'chore', label: 'Chore' },
              { value: 'bug', label: 'Bug' },
              { value: 'feature', label: 'Feature' },
            ]}
            onChange={(ticket_type) => {
              if (ticket_type !== val) saveRow(record.id, { ticket_type })
            }}
          />
        ) : (
          val
        ),
    },
    {
      title: 'User',
      dataIndex: 'user_display_name',
      width: 110,
      render: (v: string) => v || '—',
    },
    {
      title: 'Move to Soft',
      key: 'move',
      width: 130,
      fixed: 'right',
      render: (_: unknown, record) => {
        if (record.status === 'moved') {
          return (
            <Tag color="green">{record.support_ticket_ref || 'Moved'}</Tag>
          )
        }
        if (!canEditMove) return '—'
        return (
          <Button type="primary" size="small" onClick={() => onMoveToSoft(record)}>
            Move to Soft
          </Button>
        )
      },
    },
    ...(canEditAll
      ? [
          {
            title: '',
            key: 'del',
            width: 48,
            fixed: 'right' as const,
            render: (_: unknown, record: SoftSuggestion) => (
              <Popconfirm title={`Delete ${record.reference_no}?`} onConfirm={() => deleteRow(record.id)}>
                <Button type="text" danger icon={<DeleteOutlined />} loading={savingId === record.id} />
              </Popconfirm>
            ),
          },
        ]
      : []),
  ]

  return (
    <Modal
      title="Sugg Details"
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(1200px, 98vw)"
      destroyOnClose
    >
      <p style={{ color: '#64748b', marginBottom: 12 }}>
        Master Admin can edit all columns. Users with <strong>Sugg Details → Edit</strong> can use{' '}
        <strong>Move to Soft</strong> only (opens Support form; ticket appears under Support menu).
      </p>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        columns={columns}
        scroll={{ x: 1100 }}
        pagination={{ pageSize: 12, showSizeChanger: true }}
      />
    </Modal>
  )
}
