import { Card, Col, Empty, Row, Statistic, Typography } from 'antd'
import type { DashboardManagement, DashboardUserContext } from '../../types/dashboard'
import { usePermissions } from '../../hooks/usePermissions'

const { Text, Title } = Typography

interface ManagementInsightsProps {
  management: DashboardManagement | null
  user: DashboardUserContext
}

export function ManagementInsights({ management, user }: ManagementInsightsProps) {
  const { can } = usePermissions(user)
  if (!can('manageUsers')) return null

  if (!management) {
    return (
      <Card className="universal-dashboard-panel">
        <Empty description="Management insights are not available yet." />
      </Card>
    )
  }

  const metrics = [
    { label: 'Active Users', value: management.activeUsers, color: '#059669' },
    { label: 'Inactive Users', value: management.inactiveUsers, color: '#64748b' },
    { label: 'Users Overdue', value: management.usersOverdue, color: '#dc2626' },
    { label: 'Users Low KPI', value: management.usersLowKpi, color: '#d97706' },
    { label: 'Companies At Risk', value: management.companiesAtRisk, color: '#db2777' },
    { label: 'Payment Ageing Risk', value: management.paymentAgeingHighRisk, color: '#ea580c' },
  ]

  return (
    <Card className="universal-dashboard-panel">
      <div className="universal-dashboard-section-heading">
        <div>
          <Text type="secondary">Management Insights</Text>
          <Title level={4}>Team and company health</Title>
        </div>
      </div>
      <Row gutter={[16, 16]}>
        {metrics.map((metric) => (
          <Col xs={24} sm={12} lg={8} xl={4} key={metric.label}>
            <Card className="universal-dashboard-mini-card">
              <Statistic title={metric.label} value={metric.value} valueStyle={{ color: metric.color }} />
            </Card>
          </Col>
        ))}
      </Row>
    </Card>
  )
}
