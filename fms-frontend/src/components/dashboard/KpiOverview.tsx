import { Button, Card, Col, Empty, Progress, Row, Space, Typography } from 'antd'
import { KpiRingsSkeleton } from '../common/skeletons'
import { KpiCardInsights } from './KpiCardInsights'
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
import { useActiveKpiPersons } from '../../hooks/useActiveKpiPersons'
import { getDefaultPreviousWeekFilter } from '../../pages/Dashboard/kpiWeekUtils'
import { ROUTES } from '../../utils/constants'
import { DASHBOARD_KPI_PERSON_SECTION_KEY, canViewDashboardKpiPerson } from '../../utils/dashboardKpiPermissions'
import type { SectionPermission, UserRole } from '../../types/auth'
import { kpiThresholdColor, lastNWeeks } from '../../utils/kpiThresholds'

const { Text, Title } = Typography

interface KpiOverviewProps {
  user: DashboardUserContext
  selectedUserName?: string
  selectedUserEmail?: string
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

const averageNullable = (values: Array<number | null>) => {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (!valid.length) return 0
  return clampPercent(valid.reduce((sum, value) => sum + value, 0) / valid.length)
}

const souvikCompositeToPercent = (value: unknown) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return clampPercent(n * 10)
}

const formatDateIso = (date: Date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const monthStartMondayIso = (date: Date) => {
  const first = new Date(date.getFullYear(), date.getMonth(), 1)
  const day = first.getDay()
  first.setDate(first.getDate() + (day === 0 ? -6 : 1 - day))
  return formatDateIso(first)
}

interface SouvikOverviewSummary {
  weekly: number
  monthly: number
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

export function KpiOverview({ user, selectedUserName, selectedUserEmail }: KpiOverviewProps) {
  const navigate = useNavigate()
  const { user: authUser } = useAuth()
  const activeKpiPersons = useActiveKpiPersons()
  const [data, setData] = useState<DashboardKpiResponse | null>(null)
  const [souvikOverview, setSouvikOverview] = useState<SouvikOverviewSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const userRole = (authUser?.role ?? user.role) as UserRole
  const sectionPermissions = authUser?.section_permissions
  const selectedPerson = useMemo(() => {
    const filterPerson = personFromIdentity(selectedUserEmail, selectedUserName)
    if (filterPerson && canViewDashboardKpiPerson(filterPerson, userRole, sectionPermissions, activeKpiPersons)) {
      return filterPerson
    }
    const identityPerson = personFromIdentity(authUser?.email, authUser?.full_name || authUser?.display_name || user.name)
    if (identityPerson && canViewDashboardKpiPerson(identityPerson, userRole, sectionPermissions, activeKpiPersons)) {
      return identityPerson
    }
    const explicitPerson = explicitKpiGrant(sectionPermissions)
    if (explicitPerson && canViewDashboardKpiPerson(explicitPerson, userRole, sectionPermissions, activeKpiPersons)) {
      return explicitPerson
    }
    return DASHBOARD_KPI_NAMES.find((person) => canViewDashboardKpiPerson(person, userRole, sectionPermissions, activeKpiPersons)) ?? null
  }, [
    activeKpiPersons,
    authUser?.display_name,
    authUser?.email,
    authUser?.full_name,
    sectionPermissions,
    selectedUserEmail,
    selectedUserName,
    user.name,
    userRole,
  ])

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
      setSouvikOverview(null)
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setSouvikOverview(null)
    if (selectedPerson === 'Souvik') {
      const today = new Date()
      Promise.all([
        dashboardKpiApi.getSouvikKpi(),
        dashboardKpiApi.getSouvikWeeklyLog(monthStartMondayIso(today), 6),
      ])
        .then(([weekRes, monthRes]) => {
          if (cancelled) return
          const weekly = clampPercent(weekRes.weekly_percentage) || souvikCompositeToPercent(weekRes.composite_score) || 0
          const monthly =
            averageNullable(
              (monthRes.rows ?? [])
                .filter((row) => {
                  const weekDate = new Date(`${row.week_from}T00:00:00`)
                  return (
                    row.has_data &&
                    weekDate.getMonth() === today.getMonth() &&
                    weekDate.getFullYear() === today.getFullYear()
                  )
                })
                .map((row) =>
                  row.weekly_percentage != null
                    ? clampPercent(row.weekly_percentage)
                    : souvikCompositeToPercent(row.composite_score),
                ),
            ) || weekly
          setData(null)
          setSouvikOverview({ weekly, monthly })
        })
        .catch(() => {
          if (!cancelled) {
            setData(null)
            setError('Could not load Souvik KPI dashboard data.')
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
      return () => {
        cancelled = true
      }
    }
    dashboardKpiApi
      .getData({ name: selectedPerson, ...filters }, { includeProgress: true })
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
    if (selectedPerson === 'Souvik' && souvikOverview) {
      return [{ label: 'Souvik EA KPI', value: souvikOverview.weekly, color: kpiThresholdColor(souvikOverview.weekly) }]
    }
    if (!data) return []
    const next = [
      {
        label: 'Checklist',
        value: clampPercent(data.checklist?.weeklyPercentage),
        color: kpiThresholdColor(data.checklist?.weeklyPercentage),
        series: data.weeklyProgress?.checklist,
      },
      {
        label: 'Delegation',
        value: clampPercent(data.delegation?.weeklyPercentage),
        color: kpiThresholdColor(data.delegation?.weeklyPercentage),
        series: data.weeklyProgress?.delegation,
      },
      {
        label: 'Support FMS',
        value: clampPercent(data.supportFMS?.weeklyPercentage),
        color: kpiThresholdColor(data.supportFMS?.weeklyPercentage),
        series: data.weeklyProgress?.supportFMS,
      },
    ]
    if (data.successKpi) {
      next.push({
        label: 'Success / Training / Social KPI',
        value: clampPercent(data.successKpi.overallPercentage),
        color: kpiThresholdColor(data.successKpi.overallPercentage),
        series: data.weeklyProgress?.successKpi,
      })
    }
    return next
  }, [data, selectedPerson, souvikOverview])

  const weekly = selectedPerson === 'Souvik' ? souvikOverview?.weekly ?? 0 : average(bars.map((bar) => bar.value))
  const monthly =
    selectedPerson === 'Souvik'
      ? souvikOverview?.monthly ?? 0
      : data
        ? average([
            clampPercent(data.monthlyPercentages?.checklist),
            clampPercent(data.monthlyPercentages?.delegation),
            clampPercent(data.monthlyPercentages?.supportFMS),
          ])
        : 0
  const overviewSpark = useMemo(() => {
    if (!data?.weeklyProgress) return []
    const weeks = data.weeklyProgress.weeks?.length ?? 0
    if (!weeks) return lastNWeeks(data.weeklyProgress.checklist, 4)
    const out: number[] = []
    for (let i = 0; i < weeks; i++) {
      out.push(
        average([
          data.weeklyProgress.checklist?.[i] ?? 0,
          data.weeklyProgress.delegation?.[i] ?? 0,
          data.weeklyProgress.supportFMS?.[i] ?? 0,
        ]),
      )
    }
    return lastNWeeks(out, 4)
  }, [data])
  const hasOverview = selectedPerson === 'Souvik' ? !!souvikOverview : !!data
  const dashboardHref = selectedPerson ? `${ROUTES.DASHBOARD_KPI}?person=${encodeURIComponent(selectedPerson)}` : ROUTES.DASHBOARD_KPI

  return (
    <Card className="universal-dashboard-panel universal-dashboard-kpi-panel">
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div className="universal-dashboard-section-heading">
          <div>
            <Text type="secondary">KPI Overview</Text>
            <Title level={4}>{selectedPerson ? `${selectedPerson} KPI health` : 'KPI dashboard'}</Title>
          </div>
          {selectedPerson && (
            <Button type="primary" onClick={() => navigate(dashboardHref)}>
              Open KPI
            </Button>
          )}
        </div>
        {loading ? (
          <KpiRingsSkeleton />
        ) : !selectedPerson ? (
          <Empty description="No KPI dashboard is assigned for this user." />
        ) : error || !hasOverview ? (
          <Empty description={error || 'No KPI dashboard data found.'} />
        ) : (
          <>
            <Row gutter={[16, 16]} className="universal-dashboard-kpi-rings" align="middle">
              <Col xs={12}>
                <Progress type="circle" percent={weekly} strokeColor={kpiThresholdColor(weekly)} />
                <Text className="universal-dashboard-progress-label">Weekly</Text>
                <KpiCardInsights percent={weekly} weekSeries={overviewSpark} />
              </Col>
              <Col xs={12}>
                <Progress type="circle" percent={monthly} strokeColor={kpiThresholdColor(monthly)} />
                <Text className="universal-dashboard-progress-label">Monthly</Text>
              </Col>
            </Row>
            <Space direction="vertical" className="universal-dashboard-kpi-bars" style={{ width: '100%' }}>
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
