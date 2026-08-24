import { useState } from 'react'
import { Button, Form, Input, Modal, Space, Typography, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { supportApi } from '../../api/support'

const { Text } = Typography

type Props = {
  open: boolean
  onClose: () => void
  onSuccess?: (result: {
    company: { id: string; name: string }
    divisions: { id: string; name: string; company_id?: string }[]
  }) => void
}

export function AddCompanyDivisionModal({ open, onClose, onSuccess }: Props) {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)

  const handleClose = () => {
    form.resetFields()
    onClose()
  }

  const handleSubmit = () => {
    form
      .validateFields()
      .then((values) => {
        const company_name = String(values.company_name || '').trim()
        const divisionInput = String(values.division_names || '').trim()
        const division_names = divisionInput
          .split(/[,;]+/)
          .map((s) => s.trim())
          .filter(Boolean)
        if (!division_names.length) {
          message.warning('Enter at least one division name')
          return
        }
        setLoading(true)
        return supportApi
          .createCompanyWithDivisions({ company_name, division_names })
          .then((res) => {
            const createdDivs = res.divisions_created?.length ?? 0
            const parts: string[] = []
            if (res.company_created) parts.push('company added')
            if (createdDivs > 0) parts.push(`${createdDivs} division(s) added`)
            if (!parts.length) parts.push('already exists — divisions updated in list')
            message.success(parts.join('; '))
            onSuccess?.({ company: res.company, divisions: res.divisions })
            handleClose()
          })
          .catch((err) => {
            const raw = err?.response?.data?.detail
            const detail =
              typeof raw === 'string'
                ? raw
                : Array.isArray(raw)
                  ? raw[0]?.msg
                  : raw?.message || 'Failed to save company & division'
            message.error(detail)
          })
          .finally(() => setLoading(false))
      })
      .catch(() => message.warning('Fill required fields'))
  }

  return (
    <Modal
      title="Add Co. & Div."
      open={open}
      onCancel={handleClose}
      footer={null}
      destroyOnClose
      width={520}
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        Adds a company and division(s) to Support ticket dropdowns. Use comma-separated names for multiple divisions
        (e.g. RM, SMS, PP).
      </Text>
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          name="company_name"
          label="Company Name"
          rules={[
            { required: true, message: 'Company name is required' },
            { max: 200, message: 'Max 200 characters' },
          ]}
        >
          <Input placeholder="e.g. New Steel Pvt. Ltd." maxLength={200} />
        </Form.Item>
        <Form.Item
          name="division_names"
          label="Division Name(s)"
          rules={[{ required: true, message: 'At least one division is required' }]}
          extra="Comma-separated for multiple: RM, SMS, CCM"
        >
          <Input placeholder="e.g. RM or RM, SMS, PP" maxLength={500} />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Space>
            <Button type="primary" htmlType="submit" loading={loading} icon={<PlusOutlined />}>
              Submit
            </Button>
            <Button onClick={handleClose}>Cancel</Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  )
}
