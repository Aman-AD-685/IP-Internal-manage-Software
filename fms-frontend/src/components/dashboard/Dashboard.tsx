import { Alert, Col, Row, Skeleton, Space } from 'antd'
import { useEffect, useState } from 'react'
import { dashboardApi } from '../../api/dashboard'
import type { DashboardSummaryResponse } from '../../types/dashboard'
import { KpiOverview } from './KpiOverview'
import { MyWork } from './MyWork'
import { OperationsOverview } from './OperationsOverview'
import './Dashboard.css'

function DashboardSkeleton() {
  return (
    <div className="universal-dashboard">
      <Skeleton active paragraph={{ rows: 3 }} />
      <Row gutter={[16, 16]}>
        {[1, 2, 3, 4, 5].map((idx) => (
          <Col xs={24} sm={12} lg={8} xl={4} key={idx}>
            <Skeleton.Node active className="universal-dashboard-skeleton-card" />
          </Col>
        ))}
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Skeleton active paragraph={{ rows: 5 }} />
        </Col>
        <Col xs={24} lg={12}>
          <Skeleton active paragraph={{ rows: 5 }} />
        </Col>
      </Row>
    </div>
  )
}

export function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    dashboardApi
      .getSummary()
      .then((data) => {
        if (cancelled) return
        setSummary(data)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        setError(detail || 'Could not load dashboard summary.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading && !summary) return <DashboardSkeleton />

  if (!summary) {
    return (
      <div className="universal-dashboard">
        <Alert type="error" showIcon message="Dashboard unavailable" description={error} />
      </div>
    )
  }

  return (
    <div className="universal-dashboard">
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {error && <Alert type="warning" showIcon message={error} />}
        <OperationsOverview operations={summary.operations} user={summary.user} />
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <MyWork myWork={summary.myWork} />
          </Col>
          <Col xs={24} lg={12}>
            <KpiOverview user={summary.user} />
          </Col>
        </Row>
      </Space>
    </div>
  )
}
