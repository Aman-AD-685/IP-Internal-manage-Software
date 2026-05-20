import { useEffect, useState } from 'react'
import { Form, Input, Modal, Select, message } from 'antd'
import { softSuggestionsApi, type SoftSuggestionType } from '../../api/softSuggestions'

interface Props {
  open: boolean
  onClose: () => void
  onSubmitted?: () => void
}

export function SoftSuggFormModal({ open, onClose, onSubmitted }: Props) {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [userLabel, setUserLabel] = useState('—')
  const [pages, setPages] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    if (!open) return
    form.resetFields()
    softSuggestionsApi
      .me()
      .then((res) => {
        const d = res.data
        setUserLabel(d?.user_display_name || d?.email || '—')
        setPages(d?.pages ?? [])
      })
      .catch(() => {
        setUserLabel('—')
        setPages([])
      })
  }, [open, form])

  const handleSubmit = async () => {
    let values: {
      suggestion_text: string
      attach_link?: string
      page_id?: string
      ticket_type: SoftSuggestionType
    }
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setLoading(true)
    try {
      const res = await softSuggestionsApi.create({
        suggestion_text: values.suggestion_text.trim(),
        attach_link: values.attach_link?.trim(),
        page_id: values.page_id,
        ticket_type: values.ticket_type,
      })
      message.success(`Saved (${res.data?.data?.reference_no || 'OK'})`)
      onSubmitted?.()
      onClose()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail || 'Could not save')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title="S - Sugg"
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText="Submit"
      confirmLoading={loading}
      destroyOnClose
      width={560}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 8 }} initialValues={{ ticket_type: 'chore' }}>
        <Form.Item label="Submitted By">
          <Input value={userLabel} disabled />
        </Form.Item>
        <Form.Item
          name="suggestion_text"
          label="Suggestions"
          rules={[{ required: true, message: 'Required' }]}
        >
          <Input.TextArea rows={5} placeholder="Add your suggestion and changes…" maxLength={8000} showCount />
        </Form.Item>
        <Form.Item name="attach_link" label="Attach Link">
          <Input placeholder="https://…" maxLength={2000} />
        </Form.Item>
        <Form.Item name="page_id" label="Page" rules={[{ required: true, message: 'Select a page' }]}>
          <Select
            placeholder="Select page"
            showSearch
            optionFilterProp="label"
            options={pages.map((p) => ({ value: p.id, label: p.name }))}
          />
        </Form.Item>
        <Form.Item name="ticket_type" label="Type" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'chore', label: 'Chore' },
              { value: 'bug', label: 'Bug' },
              { value: 'feature', label: 'Feature' },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
