import { Button, Card, Col, Empty, Progress, Row, Space, Spin, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DASHBOARD_KPI_NAMES,
  MONTHS,
  dashboardKpiApi,
  type DashboardKpiPerson,
  type DashboardKpiResponse,
} from '../../api/dashboardKpi'
import type { DashboardUserContext } from '../../types/dashboard'
import { useAuth } from '../../hooks/useAuth'
import { getDefaultPreviousWeekFilter } from '../../pages/Dashboard/kpiWeekUtils'
import { ROUTES } from '../../utils/constants'
import { DASHBOARD_KPI_PERSON_SECTION_KEY, canViewDashboardKpiPerson } from '../../utils/dashboardKpiPermissions'
import type { SectionPermission, UserRole } from '../../types/auth'

const { Text, Title } = Typography

interface KpiOverviewProps {
  user: DashboardUserContext
}

const clampPercent = (value: unknown) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

const average = (values: number[]) => {
  const valid = values.filter((value) => Number.isFinite(value))
  if (!valid.length) return 0
  return clampPercent(valid.reduce((sum, value) => sum + value, 0) / valid.length)
}

function explicitKpiGrant(sectionPermissions?: SectionPermission[]): DashboardKpiPerson | null {
  for (const person of DASHBOARD_KPI_NAMES) {
    const key = DASHBOARD_KPI_PERSON_SECTION_KEY[person]
    const grant = sectionPermissions?.find((permission) => permission.section_key === key)
    if (grant?.can_view || grant?.can_edit) return person
  }
  return null
}

function personFromIdentity(email?: string, name?: string): DashboardKpiPerson | null {
  const haystack = `${email || ''} ${name || ''}`.toLowerCase()
  return DASHBOARD_KPI_NAMES.find((person) => haystack.includes(person.toLowerCase())) ?? null
}

export function KpiOverview({ user }: KpiOverviewProps) {
  const navigate = useNavigate()
  const { user: authUser } = useAuth()
  const [data, setData] = useState<DashboardKpiResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const userRole = (authUser?.role ?? user.role) as UserRole
  const sectionPermissions = authUser?.section_permissions
  const selectedPerson = useMemo(() => {
    const identityPerson = personFromIdentity(authUser?.email, authUser?.full_name || authUser?.display_name || user.name)
    if (identityPerson && canViewDashboardKpiPerson(identityPerson, userRole, sectionPermissions)) {
      return identityPerson
    }
    const explicitPerson = explicitKpiGrant(sectionPermissions)
    if (explicitPerson && canViewDashboardKpiPerson(explicitPerson, userRole, sectionPermissions)) {
      return explicitPerson
    }
    return DASHBOARD_KPI_NAMES.find((person) => canViewDashboardKpiPerson(person, userRole, sectionPermissions)) ?? null
  }, [authUser?.display_name, authUser?.email, authUser?.full_name, sectionPermissions, user.name, userRole])

  const filters = useMemo(() => {
    const defaults = getDefaultPreviousWeekFilter()
    return {
      month: MONTHS[defaults.monthIndex] ?? MONTHS[0],
      year: defaults.year,
      week: `week ${defaults.week}`,
    }
  }, [])

  useEffect(() => {
    if (!selectedPerson || selectedPerson === 'Soumya') {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    dashboardKpiApi
      .getData({ name: selectedPerson, ...filters })
      .then((res) => {
        if (cancelled) return
        if (res?.success === false) {
          setData(null)
          setError(res.error || 'KPI dashboard data is not available.')
          return
        }
        setData(res)
      })
      .catch(() => {
        if (!cancelled) {
          setData(null)
          setError('Could not load KPI dashboard data.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [filters, selectedPerson])

  const bars = useMemo(() => {
    if (!data) return []
    const next = [
      { label: 'Checklist', value: clampPercent(data.checklist?.weeklyPercentage), color: '#2563eb' },
      { label: 'Delegation', value: clampPercent(data.delegation?.weeklyPercentage), color: '#7c3aed' },
      { label: 'Support FMS', value: clampPercent(data.supportFMS?.weeklyPercentage), color: '#ea580c' },
    ]
    if (data.successKpi) {
      next.push({
        label: 'Success / Training / Social KPI',
        value: clampPercent(data.successKpi.overallPercentage),
        color: '#0d9488',
      })
    }
    return next
  }, [data])

  const weekly = average(bars.map((bar) => bar.value))
  const monthly = data
    ? average([
        clampPercent(data.monthlyPercentages?.checklist),
        clampPercent(data.monthlyPercentages?.delegation),
        clampPercent(data.monthlyPercentages?.supportFMS),
      ])
    : 0
  const dashboardHref = selectedPerson ? `${ROUTES.DASHBOARD_KPI}?person=${encodeURIComponent(selectedPerson)}` : ROUTES.DASHBOARD_KPI

  return (
    <Card className="universal-dashboard-panel">
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div className="universal-dashboard-section-heading">
          <div>
            <Text type="secondary">KPI Overview</Text>
            <Title level={4}>{selectedPerson ? `${selectedPerson} KPI health` : 'KPI dashboard'}</Title>
          </div>
          {selectedPerson && (
            <Button type="primary" onClick={() => navigate(dashboardHref)}>
              Open KPI Dashboard
            </Button>
          )}
        </div>
        {loading ? (
          <Spin />
        ) : !selectedPerson ? (
          <Empty description="No KPI dashboard is assigned for this user." />
        ) : error || !data ? (
          <Empty description={error || 'No KPI dashboard data found.'} />
        ) : (
          <>
            <Row gutter={[16, 16]}>
              <Col xs={12}>
                <Progress type="circle" percent={weekly} strokeColor="#059669" />
                <Text className="universal-dashboard-progress-label">Weekly</Text>
              </Col>
              <Col xs={12}>
                <Progress type="circle" percent={monthly} strokeColor="#2563eb" />
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
            </Space>
          </>
        )}
      </Space>
    </Card>
  )
}
