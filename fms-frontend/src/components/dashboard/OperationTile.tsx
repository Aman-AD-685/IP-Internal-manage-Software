import { Card, Space, Typography } from 'antd'
import type { ReactNode } from 'react'

const { Text, Title } = Typography

export interface OperationMetric {
  label: string
  value: number
}

interface OperationTileProps {
  title: string
  icon: ReactNode
  accent: string
  metrics: OperationMetric[]
  onClick?: () => void
}

export function OperationTile({ title, icon, accent, metrics, onClick }: OperationTileProps) {
  return (
    <Card
      hoverable={Boolean(onClick)}
      onClick={onClick}
      className="universal-dashboard-operation-tile"
      style={{ borderColor: `${accent}33`, background: `${accent}10` }}
    >
      <Space align="start" size="middle">
        <span className="universal-dashboard-icon-chip" style={{ background: `${accent}22`, color: accent }}>
          {icon}
        </span>
        <div>
          <Text className="universal-dashboard-tile-label">{title}</Text>
          <div className="universal-dashboard-tile-metrics">
            {metrics.map((metric) => (
              <div key={metric.label}>
                <Title level={4} style={{ color: accent }}>
                  {metric.value}
                </Title>
                <Text type="secondary">{metric.label}</Text>
              </div>
            ))}
          </div>
        </div>
      </Space>
    </Card>
  )
}
