import { Select, Tag } from 'antd'
import { TICKET_PRIORITY_OPTIONS, getPriorityTagColor } from '../../utils/ticketPriority'

const { Option } = Select

interface TicketPriorityFilterProps {
  value?: string
  onChange: (value: string) => void
  width?: number
}

export function TicketPriorityFilter({ value, onChange, width = 120 }: TicketPriorityFilterProps) {
  return (
    <Select
      placeholder="Priority color"
      style={{ width }}
      value={value || undefined}
      onChange={(v) => onChange(v || '')}
      allowClear
      getPopupContainer={() => document.body}
    >
      {TICKET_PRIORITY_OPTIONS.map((o) => (
        <Option key={o.value} value={o.value}>
          <Tag color={getPriorityTagColor(o.value)} style={{ margin: 0 }}>
            {o.label}
          </Tag>
        </Option>
      ))}
    </Select>
  )
}
