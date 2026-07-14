import { Button, Empty, Space, Typography } from 'antd'

export type SectionEmptyVariant = 'no-data' | 'no-filter-results' | 'no-permission'

export type SectionEmptyAction = {
  label: string
  onClick: () => void
  type?: 'primary' | 'default' | 'link'
}

export type SectionEmptyStateProps = {
  variant?: SectionEmptyVariant
  title: string
  description?: string
  primaryAction?: SectionEmptyAction
  secondaryAction?: SectionEmptyAction
}

/** Table / panel empty state — filter vs truly empty + optional CTAs */
export function SectionEmptyState({
  variant = 'no-data',
  title,
  description,
  primaryAction,
  secondaryAction,
}: SectionEmptyStateProps) {
  const defaultDescription =
    variant === 'no-filter-results'
      ? 'Try clearing filters or widening your search.'
      : variant === 'no-permission'
        ? 'Ask your admin to grant access under Users → permissions.'
        : undefined

  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <Space direction="vertical" size={4} style={{ maxWidth: 420, margin: '0 auto' }}>
          <Typography.Text strong style={{ fontSize: 15, color: '#0F172A' }}>
            {title}
          </Typography.Text>
          {(description || defaultDescription) && (
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {description || defaultDescription}
            </Typography.Text>
          )}
        </Space>
      }
      style={{ padding: '32px 16px' }}
    >
      {(primaryAction || secondaryAction) && (
        <Space wrap style={{ marginTop: 8 }}>
          {primaryAction ? (
            <Button type={primaryAction.type ?? 'primary'} onClick={primaryAction.onClick}>
              {primaryAction.label}
            </Button>
          ) : null}
          {secondaryAction ? (
            <Button type={secondaryAction.type ?? 'link'} onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          ) : null}
        </Space>
      )}
    </Empty>
  )
}
