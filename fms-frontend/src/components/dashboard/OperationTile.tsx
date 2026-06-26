import { Card, Space, Typography } from 'antd'
import type { CSSProperties, ReactNode } from 'react'

const { Text, Title } = Typography

export interface OperationMetric {
  label: string
  value: number | string
}

interface OperationTileProps {
  tileKey?: string
  title: string
  icon: ReactNode
  accent: string
  accentEnd?: string
  tint?: string
  metrics: OperationMetric[]
  onClick?: () => void
}

export function OperationTile({ tileKey, title, icon, accent, accentEnd, tint, metrics, onClick }: OperationTileProps) {
  return (
    <Card
      hoverable={Boolean(onClick)}
      onClick={onClick}
      className={`universal-dashboard-operation-tile ${tileKey === 'support' ? 'universal-dashboard-operation-tile-support' : 'universal-dashboard-operation-tile-standard'}`}
      style={{
        '--tile-accent': accent,
        '--tile-accent-end': accentEnd || accent,
        '--tile-tint': tint || 'rgba(99, 102, 181, 0.22)',
      } as CSSProperties}
    >
      <Space align="start" size="middle">
        <span className="universal-dashboard-icon-chip" style={{ background: `${accent}22`, color: accent }}>
          {icon}
        </span>
        <div>
          <Text className="universal-dashboard-tile-label">{title}</Text>
          <div className="universal-dashboard-tile-metrics">
            {metrics.map((metric) => (
              <div className="universal-dashboard-tile-metric" key={metric.label}>
                <Title level={4}>
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
