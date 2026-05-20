import { useEffect, useState } from 'react'
import { Form, Input, Modal, message } from 'antd'
import { improvementSuggestionsApi } from '../../api/improvementSuggestions'

interface Props {
  open: boolean
  onClose: () => void
  onSubmitted?: () => void
}

export function ImprovementSuggestionModal({ open, onClose, onSubmitted }: Props) {
  const [form] = Form.useForm<{ suggestion_text: string }>()
  const [loading, setLoading] = useState(false)
  const [userLabel, setUserLabel] = useState('—')

  useEffect(() => {
    if (!open) return
    form.resetFields()
    improvementSuggestionsApi
      .me()
      .then((res) => {
        const d = res.data
        setUserLabel(d?.user_display_name || d?.email || '—')
      })
      .catch(() => setUserLabel('—'))
  }, [open, form])

  const handleSubmit = async () => {
    let values: { suggestion_text: string }
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setLoading(true)
    try {
      const res = await improvementSuggestionsApi.create(values.suggestion_text.trim())
      message.success(`Suggestion saved (${res.data?.data?.reference_no || 'OK'})`)
      onSubmitted?.()
      onClose()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail || 'Could not save suggestion')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title="Improvement"
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText="Submit"
      confirmLoading={loading}
      destroyOnClose
      width={560}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item label="User" style={{ marginBottom: 12 }}>
          <Input value={userLabel} disabled />
        </Form.Item>
        <Form.Item
          name="suggestion_text"
          label="Add your Suggestion & Changes"
          rules={[{ required: true, message: 'Please enter your suggestion' }]}
        >
          <Input.TextArea rows={6} placeholder="Describe your suggestion or requested change…" maxLength={8000} showCount />
        </Form.Item>
      </Form>
    </Modal>
  )
}
