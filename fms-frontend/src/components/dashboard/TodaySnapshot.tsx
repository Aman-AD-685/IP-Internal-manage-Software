import { Card, Col, Row, Statistic } from 'antd'
import {
  AlertOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import type { DashboardSnapshot } from '../../types/dashboard'

interface TodaySnapshotProps {
  snapshot: DashboardSnapshot
}

export function TodaySnapshot({ snapshot }: TodaySnapshotProps) {
  const cards = [
    { label: 'Pending Bug (Till date)', value: snapshot.dueToday, color: '#2563eb', icon: <ClockCircleOutlined /> },
    { label: 'Pending Approval Features', value: snapshot.pendingApprovals, color: '#d97706', icon: <AlertOutlined /> },
  ]

  return (
    <Row gutter={[16, 16]}>
      {cards.map((card) => (
        <Col xs={24} sm={12} lg={8} xl={6} key={card.label}>
          <Card className="universal-dashboard-stat-card" style={{ background: `${card.color}10` }}>
            <span className="universal-dashboard-icon-chip" style={{ background: `${card.color}22`, color: card.color }}>
              {card.icon}
            </span>
            <Statistic
              title={card.label}
              value={card.value}
              suffix={card.suffix}
              valueStyle={{ color: card.color }}
            />
          </Card>
        </Col>
      ))}
    </Row>
  )
}
