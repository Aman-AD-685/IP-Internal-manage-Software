import { Alert, Button, Card, Col, Empty, List, Modal, Row, Skeleton, Space, Typography } from 'antd'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { checklistApi } from '../../api/checklist'
import {
  dashboardApi,
  type DashboardAttendanceLeaveUserSummary,
  type DashboardUserWorkSummary,
} from '../../api/dashboard'
import type { DashboardSummaryResponse } from '../../types/dashboard'
import { getDefaultPreviousWeekFilter } from '../../pages/Dashboard/kpiWeekUtils'
import { ROUTES } from '../../utils/constants'
import { genericLogicalKey, sessionApiCacheGetStale } from '../../utils/sessionApiCache'
import { storage } from '../../utils/storage'
import './Dashboard.css'

const { Text, Title } = Typography
const OperationsOverview = lazy(() => import('./OperationsOverview').then((m) => ({ default: m.OperationsOverview })))
const MyWork = lazy(() => import('./MyWork').then((m) => ({ default: m.MyWork })))
const KpiOverview = lazy(() => import('./KpiOverview').then((m) => ({ default: m.KpiOverview })))
const DASHBOARD_KPI_NAMES = ['Shreyasi', 'Rimpa', 'Akash', 'Adrija', 'Soumya', 'Souvik'] as const
const ADMIN_DASHBOARD_USERS = DASHBOARD_KPI_NAMES.filter((name) => name !== 'Soumya')
const EXCLUDED_ADMIN_DASHBOARD_USERS = ['ayussh jhunjhunwala', 'bot', 'shubham', 'test']

type DashboardPerson = { id: string; full_name: string }
type DashboardKpiPerson = (typeof DASHBOARD_KPI_NAMES)[number]
type KpiOnlySummary = { weekly: number | null; monthly: number | null }
type AttendanceLeaveSummaryMap = Record<string, DashboardAttendanceLeaveUserSummary>
type UserWorkSummaryMap = Record<string, DashboardUserWorkSummary>
type WorkSummaryKind = 'checklist' | 'delegation' | 'attendance' | 'leave'

const personNameFromUser = (name: string) => {
  const normalized = name.trim().toLowerCase()
  return ADMIN_DASHBOARD_USERS.find((person) => normalized.includes(person.toLowerCase()))
}

const isAdminDashboardRole = (role?: string) => {
  const normalized = (role || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return normalized === 'master_admin' || normalized === 'admin'
}

const normalizeDashboardRole = (role?: string): 'admin' | 'master_admin' | 'user' => {
  const normalized = (role || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized === 'master_admin') return 'master_admin'
  if (normalized === 'admin') return 'admin'
  return 'user'
}

const fullAdminPermissions = {
  support: true,
  success: true,
  clientToLead: true,
  onboarding: true,
  training: true,
  clientPayment: true,
  dbClient: true,
  viewKpiSuccess: true,
  manageUsers: true,
  globalFilters: true,
}

const emptyDashboardSummaryForCurrentAdmin = (): DashboardSummaryResponse | null => {
  const user = storage.getUser()
  if (!user || !isAdminDashboardRole(user.role)) return null
  return {
    user: {
      userId: user.id,
      name: user.full_name || user.email || 'Admin',
      role: normalizeDashboardRole(user.role),
      companyIds: [],
      permissions: fullAdminPermissions,
    },
    snapshot: {
      dueToday: 0,
      overdue: 0,
      pendingApprovals: 0,
      kpiScore: 0,
      highRisk: 0,
    },
    myWork: {
      checklistDueToday: 0,
      completedPct: 0,
      assignedToMe: 0,
      delegatedByMe: 0,
      supportTickets: 0,
    },
    kpi: {
      weekly: 0,
      monthly: 0,
      checklistPct: 0,
      delegationPct: 0,
      supportFmsPct: 0,
      successKpi: null,
    },
    operations: {
      support: {
        open: 0,
        openChores: 0,
        openBugs: 0,
        openFeatures: 0,
        pendingFeatureApprovals: 0,
        delayedResponse: 0,
        delayedCompletion: 0,
      },
      clientToLead: {
        newLeads: 0,
        followUpDue: 0,
        closed: 0,
      },
      success: {
        active: 0,
        completed: 0,
        lowPerformance: 0,
      },
      onboarding: {
        active: 0,
        stuckStage: 0,
        pendingSetup: 0,
      },
      training: {
        scheduled: 0,
        pending: 0,
        completed: 0,
      },
      clientPayment: {
        pending: 0,
        totalPendingAmount: 0,
        ageingRisk: 0,
        completedRegister: 0,
      },
      dbClient: {
        active: 0,
        inactive: 0,
        missingFollowUp: 0,
      },
    },
    management: {
      activeUsers: 0,
      inactiveUsers: 0,
      usersOverdue: 0,
      usersLowKpi: 0,
      companiesAtRisk: 0,
      paymentAgeingHighRisk: 0,
    },
  }
}

const clampPercent = (value: unknown) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, Math.round(n)))
}

async function loadKpiOnlySummary(person: DashboardKpiPerson): Promise<KpiOnlySummary> {
  const { MONTHS, dashboardKpiApi } = await import('../../api/dashboardKpi')
  if (person === 'Souvik') {
    const res = await dashboardKpiApi.getSouvikKpi()
    const score = clampPercent(res.composite_score)
    return { weekly: score, monthly: score }
  }

  const defaults = getDefaultPreviousWeekFilter()
  const data = await dashboardKpiApi.getData({
    name: person,
    month: MONTHS[defaults.monthIndex] ?? MONTHS[0],
    year: defaults.year,
    week: `week ${defaults.week}`,
  })
  if (person === 'Shreyasi') {
    return {
      weekly: clampPercent(data.supportFMS?.weeklyPercentage),
      monthly: clampPercent(data.supportFMS?.monthlyPercentage) ?? clampPercent(data.monthlyPercentages?.supportFMS),
    }
  }

  const weekly =
    clampPercent(data.akashKpi?.overall_score_percent) ??
    clampPercent(data.successKpi?.overallPercentage) ??
    clampPercent(data.adrijaSocialKpi?.weeklyPercent)
  const monthly =
    clampPercent(data.akashKpi?.overall_score_monthly_percent) ??
    clampPercent(data.akashKpi?.monthly?.overall_score_percent) ??
    clampPercent(data.adrijaSocialKpi?.monthlyPercent) ??
    weekly

  return { weekly, monthly }
}

function AdminUserOverviewCards({
  users,
  kpiSummaries,
  attendanceLeaveSummaries,
  workSummaries,
  loading,
  onOpenWorkSummary,
}: {
  users: DashboardPerson[]
  kpiSummaries: Record<string, KpiOnlySummary>
  attendanceLeaveSummaries: AttendanceLeaveSummaryMap
  workSummaries: UserWorkSummaryMap
  loading: boolean
  onOpenWorkSummary: (kind: WorkSummaryKind, user: DashboardPerson) => void
}) {
  const navigate = useNavigate()

  if (loading && users.length === 0) {
    return (
      <Row gutter={[16, 16]}>
        {[1, 2, 3, 4].map((idx) => (
          <Col xs={24} md={12} xl={6} key={idx}>
            <Skeleton.Node active className="universal-dashboard-skeleton-card" />
          </Col>
        ))}
      </Row>
    )
  }

  if (!users.length) {
    return <Empty description="No user dashboards are available." />
  }

  return (
    <div className="universal-dashboard-user-grid">
      {users.map((item) => {
        const kpiPerson = personNameFromUser(item.full_name)
        const personName = kpiPerson ?? item.full_name
        const kpiHref = kpiPerson ? `${ROUTES.DASHBOARD_KPI}?person=${encodeURIComponent(kpiPerson)}` : ''
        const workSummary = workSummaries[item.id]
        const checklistDue = workSummary?.checklist.count ?? 0
        const delegationDue = workSummary?.delegation.count ?? 0
        const weeklyKpi = kpiSummaries[item.id]?.weekly
        const monthlyKpi = kpiSummaries[item.id]?.monthly
        const attendance = attendanceLeaveSummaries[item.id]?.attendance
        const leave = attendanceLeaveSummaries[item.id]?.leave

        return (
          <Card className="universal-dashboard-user-card" key={item.id}>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div>
                <Text type="secondary">User Dashboard</Text>
                <Title level={4}>{personName} Dashboard</Title>
              </div>

              <div className="universal-dashboard-user-card-metrics">
                <button
                  type="button"
                  className="universal-dashboard-user-card-metric-clickable"
                  onClick={() => onOpenWorkSummary('checklist', item)}
                >
                  <Text type="secondary">Checklist</Text>
                  <Title level={4}>{checklistDue}</Title>
                  <Text type="secondary">Pending today</Text>
                </button>
                <button
                  type="button"
                  className="universal-dashboard-user-card-metric-clickable"
                  onClick={() => onOpenWorkSummary('delegation', item)}
                >
                  <Text type="secondary">Delegation</Text>
                  <Title level={4}>{delegationDue}</Title>
                  <Text type="secondary">Assigned</Text>
                </button>
                {kpiPerson && (
                  <>
                    <div>
                      <Text type="secondary">Weekly KPI</Text>
                      <Title level={4}>{weeklyKpi == null ? '-' : `${weeklyKpi}%`}</Title>
                      <Text type="secondary">Overview</Text>
                    </div>
                    <div>
                      <Text type="secondary">Monthly KPI</Text>
                      <Title level={4}>{monthlyKpi == null ? '-' : `${monthlyKpi}%`}</Title>
                      <Text type="secondary">Overview</Text>
                    </div>
                  </>
                )}
                <button
                  type="button"
                  className="universal-dashboard-user-card-metric-clickable"
                  onClick={() => onOpenWorkSummary('attendance', item)}
                >
                  <Text type="secondary">Attendance</Text>
                  <Title level={4}>{attendance?.present ?? 0}</Title>
                  <Text type="secondary">This month</Text>
                </button>
                <button
                  type="button"
                  className="universal-dashboard-user-card-metric-clickable"
                  onClick={() => onOpenWorkSummary('leave', item)}
                >
                  <Text type="secondary">Leave</Text>
                  <Title level={4}>{attendance?.absent ?? 0}</Title>
                  <Text type="secondary">Days this month</Text>
                </button>
              </div>

              {kpiPerson && (
                <Space wrap>
                  <Button type="primary" onClick={() => navigate(kpiHref)}>
                    KPI Details
                  </Button>
                </Space>
              )}
            </Space>
          </Card>
        )
      })}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="universal-dashboard">
      <div className="universal-dashboard-content">
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
    </div>
  )
}

function DashboardChunkFallback() {
  return <Skeleton active paragraph={{ rows: 4 }} />
}

export function Dashboard() {
  const cachedSummary = sessionApiCacheGetStale<DashboardSummaryResponse>(genericLogicalKey('dashboard:summary', {}))
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(cachedSummary)
  const [users, setUsers] = useState<DashboardPerson[]>([])
  const [userKpiSummaries, setUserKpiSummaries] = useState<Record<string, KpiOnlySummary>>({})
  const [attendanceLeaveSummaries, setAttendanceLeaveSummaries] = useState<AttendanceLeaveSummaryMap>({})
  const [workSummaries, setWorkSummaries] = useState<UserWorkSummaryMap>({})
  const [activeWorkSummary, setActiveWorkSummary] = useState<{
    kind: WorkSummaryKind
    user: DashboardPerson
  } | null>(null)
  const [loading, setLoading] = useState(!cachedSummary)
  const [error, setError] = useState<string | null>(null)
  const canShowUserOverview = isAdminDashboardRole(summary?.user.role)
  const effectiveUserId = summary?.user.userId
  const selectedDashboardUser = useMemo(() => {
    if (!effectiveUserId) return null
    return users.find((item) => item.id === effectiveUserId) ?? (
      summary?.user.userId === effectiveUserId ? { id: summary.user.userId, full_name: summary.user.name } : null
    )
  }, [effectiveUserId, summary?.user.name, summary?.user.userId, users])

  useEffect(() => {
    let cancelled = false
    if (!cachedSummary) setLoading(true)
    setError(null)
    dashboardApi
      .getSummary()
      .then((data) => {
        if (cancelled) return
        setSummary(data)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const status = (err as { response?: { status?: number } })?.response?.status
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        const fallbackSummary = !status || status >= 500 ? emptyDashboardSummaryForCurrentAdmin() : null
        if (fallbackSummary) {
          setSummary(fallbackSummary)
          setError(null)
          return
        }
        setError(detail || 'Could not load dashboard summary.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!canShowUserOverview || !summary) return
    let cancelled = false
    checklistApi.getUsers().then((res) => {
      if (cancelled) return
      const loaded = res.users || []
      const hasCurrentUser = loaded.some((item) => item.id === summary.user.userId)
      setUsers(hasCurrentUser ? loaded : [{ id: summary.user.userId, full_name: summary.user.name }, ...loaded])
    }).catch(() => {
      if (!cancelled) setUsers([{ id: summary.user.userId, full_name: summary.user.name }])
    })
    return () => {
      cancelled = true
    }
  }, [canShowUserOverview, summary])

  const adminDashboardUsers = useMemo(() => {
    if (!canShowUserOverview) return []
    return users.filter((item) => {
      const name = item.full_name.toLowerCase()
      const compactName = name.replace(/\s+/g, ' ').trim()
      return (
        !name.includes('soumya') &&
        compactName !== 'ad' &&
        compactName !== 'ad dashboard' &&
        !EXCLUDED_ADMIN_DASHBOARD_USERS.some((excluded) => name.includes(excluded))
      )
    })
  }, [canShowUserOverview, users])

  useEffect(() => {
    if (!canShowUserOverview || !adminDashboardUsers.length) {
      setUserKpiSummaries({})
      return
    }
    let cancelled = false
    Promise.allSettled(
      adminDashboardUsers.map((item) => {
        const person = personNameFromUser(item.full_name)
        return person ? loadKpiOnlySummary(person) : Promise.resolve({ weekly: null, monthly: null })
      }),
    ).then((results) => {
      if (cancelled) return
      const next: Record<string, KpiOnlySummary> = {}
      results.forEach((result, index) => {
        next[adminDashboardUsers[index].id] = result.status === 'fulfilled'
          ? result.value
          : { weekly: null, monthly: null }
      })
      setUserKpiSummaries(next)
    })
    return () => {
      cancelled = true
    }
  }, [adminDashboardUsers, canShowUserOverview])

  useEffect(() => {
    if (!canShowUserOverview || !adminDashboardUsers.length) {
      setAttendanceLeaveSummaries({})
      return
    }
    let cancelled = false
    dashboardApi
      .getAttendanceLeaveSummary({ users: adminDashboardUsers })
      .then((res) => {
        if (!cancelled) setAttendanceLeaveSummaries(res.users || {})
      })
      .catch(() => {
        if (!cancelled) setAttendanceLeaveSummaries({})
      })
    return () => {
      cancelled = true
    }
  }, [adminDashboardUsers, canShowUserOverview])

  useEffect(() => {
    if (!canShowUserOverview || !adminDashboardUsers.length) {
      setWorkSummaries({})
      return
    }
    let cancelled = false
    dashboardApi
      .getUserWorkSummary({ users: adminDashboardUsers })
      .then((res) => {
        if (!cancelled) setWorkSummaries(res.users || {})
      })
      .catch(() => {
        if (!cancelled) setWorkSummaries({})
      })
    return () => {
      cancelled = true
    }
  }, [adminDashboardUsers, canShowUserOverview])

  const activeSummary = activeWorkSummary ? workSummaries[activeWorkSummary.user.id] : null
  const activeSummaryBlock =
    activeWorkSummary && activeSummary && (activeWorkSummary.kind === 'checklist' || activeWorkSummary.kind === 'delegation')
      ? activeSummary[activeWorkSummary.kind]
      : null
  const activeAttendance = activeWorkSummary ? attendanceLeaveSummaries[activeWorkSummary.user.id] : null
  const activeSummaryTitle =
    activeWorkSummary?.kind === 'checklist'
      ? 'Checklist'
      : activeWorkSummary?.kind === 'delegation'
        ? 'Delegation'
        : activeWorkSummary?.kind === 'attendance'
          ? 'Attendance'
          : 'Leave'

  useEffect(() => {
    if (!summary || window.location.hash !== '#accessible-sections') return
    requestAnimationFrame(() => {
      document.getElementById('accessible-sections')?.scrollIntoView({ block: 'start' })
    })
  }, [summary])

  if (loading && !summary) return <DashboardSkeleton />

  if (!summary) {
    return (
      <div className="universal-dashboard">
        <div className="universal-dashboard-content">
          <Alert type="error" showIcon message="Dashboard unavailable" description={error} />
        </div>
      </div>
    )
  }

  return (
    <div className="universal-dashboard">
      <div className="universal-dashboard-content">
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {error && <Alert type="warning" showIcon message={error} />}
          <Suspense fallback={<DashboardChunkFallback />}>
            <OperationsOverview operations={summary.operations} user={summary.user} />
          </Suspense>
          {canShowUserOverview ? (
            <AdminUserOverviewCards
              users={adminDashboardUsers}
              kpiSummaries={userKpiSummaries}
              attendanceLeaveSummaries={attendanceLeaveSummaries}
              workSummaries={workSummaries}
              loading={!adminDashboardUsers.length}
              onOpenWorkSummary={(kind, user) => setActiveWorkSummary({ kind, user })}
            />
          ) : (
            <Suspense fallback={<DashboardChunkFallback />}>
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={12}>
                  <MyWork myWork={summary.myWork} selectedUser={selectedDashboardUser ?? undefined} />
                </Col>
                <Col xs={24} lg={12}>
                  <KpiOverview user={summary.user} selectedUserName={selectedDashboardUser?.full_name} />
                </Col>
              </Row>
            </Suspense>
          )}
        </Space>
        <Modal
          title={
            activeWorkSummary
              ? `${activeWorkSummary.user.full_name} ${activeSummaryTitle} Summary`
              : 'Summary'
          }
          open={!!activeWorkSummary}
          onCancel={() => setActiveWorkSummary(null)}
          footer={null}
          width={720}
        >
          {activeWorkSummary?.kind === 'attendance' || activeWorkSummary?.kind === 'leave' ? (
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Text type="secondary">
                {activeWorkSummary.kind === 'attendance' ? 'Present dates' : 'Absent dates'}
                {activeAttendance?.attendance.dataUntil ? ` until ${activeAttendance.attendance.dataUntil}` : ''}
              </Text>
              <List
                bordered
                dataSource={
                  activeWorkSummary.kind === 'attendance'
                    ? activeAttendance?.attendance.presentDates || []
                    : activeAttendance?.attendance.absentDates || []
                }
                locale={{
                  emptyText:
                    activeWorkSummary.kind === 'attendance'
                      ? 'No present dates found.'
                      : 'No absent dates found.',
                }}
                renderItem={(date) => (
                  <List.Item>
                    <Text>{date}</Text>
                  </List.Item>
                )}
              />
            </Space>
          ) : (
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Text type="secondary">
                Previous week pending
                {activeSummary?.range ? ` (${activeSummary.range.from} to ${activeSummary.range.to})` : ''}
              </Text>
              <List
                bordered
                dataSource={activeSummaryBlock?.items || []}
                locale={{ emptyText: 'No previous week pending items.' }}
                renderItem={(item) => (
                  <List.Item>
                    <Space direction="vertical" size={2}>
                      <Text strong>{item.title || 'Untitled'}</Text>
                      <Text type="secondary">
                        {[item.referenceNo, item.date, item.status].filter(Boolean).join(' · ')}
                      </Text>
                    </Space>
                  </List.Item>
                )}
              />
            </Space>
          )}
        </Modal>
      </div>
    </div>
  )
}
