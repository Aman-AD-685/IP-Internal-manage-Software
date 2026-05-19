import { useState } from 'react'
import { Form, Input, Button, Card, Typography, Select, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { ticketsApi } from '../../api/tickets'
import { ROUTES } from '../../utils/constants'
import { TICKET_PRIORITY_OPTIONS, normalizePriorityValue } from '../../utils/ticketPriority'

const { Title } = Typography
const { TextArea } = Input

export const CreateTicket = () => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const onFinish = async (values: Record<string, unknown>) => {
    setLoading(true)
    try {
      const res = await ticketsApi.create({
        title: values.title as string,
        description: values.description as string,
        type: values.type as 'bug' | 'feature' | 'chore',
        priority: normalizePriorityValue(values.priority as string),
      })
      const ticketId = res?.data?.id
      if (ticketId) {
        message.success('Ticket created')
        navigate(`${ROUTES.TICKETS}/${ticketId}`)
      } else {
        message.error('Ticket created but no ID returned')
        if (process.env.NODE_ENV !== 'production') console.error('Create ticket response:', res)
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail ?? err?.message ?? 'Failed to create ticket'
      const msg =
        typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail.map((d: any) => (d?.msg != null ? d.msg : String(d))).join(' ')
            : 'Failed to create ticket'
      message.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Title level={2} className="page-main-heading">Create Ticket</Title>
      <Card>
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input placeholder="Ticket title" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <TextArea rows={4} placeholder="Description" />
          </Form.Item>
          <Form.Item name="type" label="Type" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="bug">Bug</Select.Option>
              <Select.Option value="feature">Feature</Select.Option>
              <Select.Option value="chore">Chores</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="priority" label="Priority" initialValue="medium">
            <Select options={[...TICKET_PRIORITY_OPTIONS]} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading}>
              Create
            </Button>
            <Button style={{ marginLeft: 8 }} onClick={() => navigate(ROUTES.TICKETS)}>
              Cancel
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
