import { Card, Col, Progress, Row, Space, Typography } from 'antd'
import type { DashboardKpi, DashboardUserContext } from '../../types/dashboard'
import { usePermissions } from '../../hooks/usePermissions'

const { Text, Title } = Typography

interface KpiOverviewProps {
  kpi: DashboardKpi
  user: DashboardUserContext
}

export function KpiOverview({ kpi, user }: KpiOverviewProps) {
  const { can } = usePermissions(user)
  const bars = [
    { label: 'Checklist', value: kpi.checklistPct, color: '#2563eb' },
    { label: 'Delegation', value: kpi.delegationPct, color: '#7c3aed' },
    { label: 'Support FMS', value: kpi.supportFmsPct, color: '#ea580c' },
  ]

  return (
    <Card className="universal-dashboard-panel">
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Text type="secondary">KPI Overview</Text>
          <Title level={4}>Weekly and monthly health</Title>
        </div>
        <Row gutter={[16, 16]}>
          <Col xs={12}>
            <Progress type="circle" percent={kpi.weekly} strokeColor="#059669" />
            <Text className="universal-dashboard-progress-label">Weekly</Text>
          </Col>
          <Col xs={12}>
            <Progress type="circle" percent={kpi.monthly} strokeColor="#2563eb" />
            <Text className="universal-dashboard-progress-label">Monthly</Text>
          </Col>
        </Row>
        <Space direction="vertical" style={{ width: '100%' }}>
          {bars.map((bar) => (
            <div key={bar.label}>
              <div className="universal-dashboard-bar-label">
                <Text>{bar.label}</Text>
                <Text strong>{bar.value}%</Text>
              </div>
              <Progress percent={bar.value} strokeColor={bar.color} showInfo={false} />
            </div>
          ))}
          {can('viewKpiSuccess') && kpi.successKpi != null && (
            <div>
              <div className="universal-dashboard-bar-label">
                <Text>Success / Training / Social KPI</Text>
                <Text strong>{kpi.successKpi}%</Text>
              </div>
              <Progress percent={kpi.successKpi} strokeColor="#0d9488" showInfo={false} />
            </div>
          )}
        </Space>
      </Space>
    </Card>
  )
}
