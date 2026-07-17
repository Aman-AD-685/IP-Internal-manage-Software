import { Button, Space, Typography } from 'antd'

const { Text } = Typography

/** Sticky bar when table rows are selected for bulk actions. */
export function BulkActionBar({
  count,
  onClear,
  children,
  eligibilityHint,
}: {
  count: number
  onClear: () => void
  children: React.ReactNode
  /** e.g. "3 of 5 can be completed" */
  eligibilityHint?: string
}) {
  if (count <= 0) return null
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        marginBottom: 12,
        padding: '10px 14px',
        background: '#f0f5ff',
        border: '1px solid #adc6ff',
        borderRadius: 8,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        justifyContent: 'space-between',
      }}
    >
      <Space wrap size="middle">
        <Text strong>{count} selected</Text>
        {eligibilityHint ? <Text type="secondary">{eligibilityHint}</Text> : null}
      </Space>
      <Space wrap>
        {children}
        <Button size="small" onClick={onClear}>
          Clear
        </Button>
      </Space>
    </div>
  )
}
