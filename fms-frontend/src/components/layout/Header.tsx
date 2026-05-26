import { Layout, Dropdown, Avatar, Space, Typography, Button, Badge } from 'antd'
import {
  UserOutlined,
  LogoutOutlined,
  PlusOutlined,
  MenuOutlined,
  BellOutlined,
  DashboardOutlined,
  BulbOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect, useMemo, useCallback } from 'react'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)
import { useAuth } from '../../hooks/useAuth'
import { useRole } from '../../hooks/useRole'
import { ImprovementSuggestionModal } from '../improvement/ImprovementSuggestionModal'
import { ImprovementI1AdminModal } from '../improvement/ImprovementI1AdminModal'
import { getInitials, canViewSection } from '../../utils/helpers'
import { ROUTES } from '../../utils/constants'
import { ContextMenuTarget } from '../common/ContextMenuTarget'
import { OPEN_ACTION, buildOpenActionUrl } from '../../utils/openActions'
import { useDeepLinkAction } from '../../hooks/useDeepLinkAction'
import type { UserRole } from '../../types/auth'
import { dashboardApi, type Stage2RemarkNotificationItem } from '../../api/dashboard'
import { STAGE2_REMARK_ADDED_EVENT } from '../../utils/stage2RemarkEvents'
import { improvementSuggestionsApi } from '../../api/improvementSuggestions'
import { DASHBOARD_KPI_NAMES, prefetchDashboardKpiPerson, MONTHS } from '../../api/dashboardKpi'
import { getDefaultPreviousWeekFilter } from '../../pages/Dashboard/kpiWeekUtils'
import { canViewDashboardKpiPerson } from '../../utils/dashboardKpiPermissions'

const { Header: AntHeader } = Layout
const { Text } = Typography

interface HeaderProps {
  onAddNew?: () => void
  onMenuClick?: () => void
  showMenuButton?: boolean
}

export const Header = ({ onAddNew, onMenuClick, showMenuButton }: HeaderProps) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()
  const { role: userRole } = useRole()
  const sectionPermissions = user?.section_permissions
  const canImprovement = canViewSection('improvement', userRole as UserRole, sectionPermissions)
  const canImprovementI1 = canViewSection('improvement_i1', userRole as UserRole, sectionPermissions)
  const [stage2Notifications, setStage2Notifications] = useState<Stage2RemarkNotificationItem[]>([])
  const [stage2NotifyCount, setStage2NotifyCount] = useState(0)
  const [improvementOpen, setImprovementOpen] = useState(false)
  const [i1Open, setI1Open] = useState(false)
  const searchParams = new URLSearchParams(location.search)
  const section = searchParams.get('section')
  const viewApproval = searchParams.get('view') === 'approval'
  const hideAddNew = section === 'completed-chores-bugs' || section === 'completed-feature' || section === 'solutions' || location.pathname === ROUTES.STAGING || location.pathname === ROUTES.CHECKLIST || location.pathname === ROUTES.DELEGATION || viewApproval

  const canViewDashboardKpi = user
    ? canViewSection('dashboard_kpi', user.role as UserRole, user.section_permissions)
    : false

  const loadStage2Notifications = useCallback((options?: { skipCache?: boolean }) => {
    return dashboardApi
      .getStage2RemarkNotifications(options)
      .then((res) => {
        const unread = res.unread_count ?? res.count ?? 0
        setStage2Notifications(res.items ?? [])
        setStage2NotifyCount(unread)
        return res
      })
      .catch(() => {
        setStage2Notifications([])
        setStage2NotifyCount(0)
        return null
      })
  }, [])

  const handleStage2BellOpen = useCallback(
    async (open: boolean) => {
      if (!open) return
      const res = await loadStage2Notifications({ skipCache: true })
      if (!res) return
      const unreadIds = (res.items ?? []).filter((i) => !i.seen).map((i) => i.id)
      const idsToMark = unreadIds.length > 0 ? unreadIds : (res.items ?? []).map((i) => i.id)
      if (idsToMark.length > 0) {
        try {
          await dashboardApi.markStage2RemarkNotificationsSeen(idsToMark)
        } catch {
          /* badge may stay until next poll if DB migration missing */
        }
      }
      setStage2NotifyCount(0)
      setStage2Notifications((res.items ?? []).map((i) => ({ ...i, seen: true })))
    },
    [loadStage2Notifications],
  )

  useEffect(() => {
    const t = window.setTimeout(loadStage2Notifications, 2500)
    const poll = window.setInterval(loadStage2Notifications, 60_000)
    const onRemark = () => loadStage2Notifications()
    window.addEventListener(STAGE2_REMARK_ADDED_EVENT, onRemark)
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadStage2Notifications()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(t)
      window.clearInterval(poll)
      window.removeEventListener(STAGE2_REMARK_ADDED_EVENT, onRemark)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadStage2Notifications])

  const openStage2Ticket = (item: Stage2RemarkNotificationItem) => {
    const ticketType = item.ticket_type === 'bug' ? 'bug' : 'chore'
    navigate(
      { pathname: ROUTES.TICKETS, search: '?section=chores-bugs' },
      { state: { openTicketId: item.ticket_id, openTicketType: ticketType } },
    )
  }

  useEffect(() => {
    if (!canImprovementI1) return
    const t = window.setTimeout(() => improvementSuggestionsApi.prefetchList(), 3500)
    return () => window.clearTimeout(t)
  }, [canImprovementI1])

  const improvementHref = buildOpenActionUrl(
    location.pathname,
    location.search,
    OPEN_ACTION.IMPROVEMENT,
  )
  const improvementI1Href = buildOpenActionUrl(
    location.pathname,
    location.search,
    OPEN_ACTION.IMPROVEMENT_I1,
  )
  const supportTicketHref = buildOpenActionUrl(
    location.pathname,
    location.search,
    OPEN_ACTION.SUPPORT_TICKET,
  )

  const defaultKpiHref = useMemo(() => {
    if (!user) return ROUTES.DASHBOARD_KPI
    const names = DASHBOARD_KPI_NAMES.filter((name) =>
      canViewDashboardKpiPerson(name, user.role as UserRole, user.section_permissions),
    )
    const first = names[0]
    return first
      ? `${ROUTES.DASHBOARD_KPI}?person=${encodeURIComponent(first)}`
      : ROUTES.DASHBOARD_KPI
  }, [user])

  useDeepLinkAction(OPEN_ACTION.IMPROVEMENT, () => setImprovementOpen(true), canImprovement)
  useDeepLinkAction(OPEN_ACTION.IMPROVEMENT_I1, () => setI1Open(true), canImprovementI1)

  const handleLogout = () => {
    logout()
    navigate(ROUTES.LOGIN)
  }

  const kpiFilterDefaults = useMemo(() => {
    const prev = getDefaultPreviousWeekFilter()
    return {
      month: MONTHS[prev.monthIndex] ?? MONTHS[0],
      year: prev.year,
      week: `week ${prev.week}`,
    }
  }, [])

  const dashboardKpiMenuItems: MenuProps['items'] = user
    ? DASHBOARD_KPI_NAMES.filter((name) =>
        canViewDashboardKpiPerson(name, user.role as UserRole, user.section_permissions),
      ).map((name) => {
        const href = `${ROUTES.DASHBOARD_KPI}?person=${encodeURIComponent(name)}`
        return {
          key: `dashboard-kpi-${name}`,
          label: (
            <span
              data-open-href={href}
              data-open-label={`${name} Dashboard`}
              onMouseEnter={() => prefetchDashboardKpiPerson(name, kpiFilterDefaults)}
            >
              {name} Dashboard
            </span>
          ),
          onClick: () => {
            prefetchDashboardKpiPerson(name, kpiFilterDefaults)
            navigate(href)
          },
        }
      })
    : []

  const menuItems: MenuProps['items'] = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: 'Profile',
      onClick: () => navigate(ROUTES.SETTINGS),
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Logout',
      onClick: handleLogout,
    },
  ]

  return (
    <AntHeader
      className="no-print app-header"
      style={{
        background: '#fff',
        padding: '0 24px',
        borderBottom: '2px solid #4A6BFF',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        position: 'fixed',
        top: 0,
        right: 0,
        left: 0,
        zIndex: 1000,
        height: 64,
      }}
    >
      <Space size="middle">
        {showMenuButton && (
          <Button
            type="text"
            icon={<MenuOutlined />}
            onClick={onMenuClick}
            style={{ fontSize: 18, color: '#4A6BFF' }}
            aria-label="Open menu"
          />
        )}
        <img src="/logo.png" alt="Logo" style={{ height: 32, width: 'auto', objectFit: 'contain' }} />
      </Space>
      <Space size="middle">
        {canImprovementI1 ? (
          <ContextMenuTarget openHref={improvementI1Href} openLabel="I - 1">
            <Button type="default" onClick={() => setI1Open(true)} className="kpi-header-trigger-btn">
              I - 1
            </Button>
          </ContextMenuTarget>
        ) : null}
        {canImprovement ? (
          <ContextMenuTarget openHref={improvementHref} openLabel="Improvement">
            <Button type="default" icon={<BulbOutlined />} onClick={() => setImprovementOpen(true)}>
              Improvement
            </Button>
          </ContextMenuTarget>
        ) : null}
        {canViewDashboardKpi ? (
          <ContextMenuTarget openHref={defaultKpiHref} openLabel="Dashboard - KPI">
            <Dropdown
              onOpenChange={(open) => {
                if (!open || !user) return
                const first = DASHBOARD_KPI_NAMES.find((name) =>
                  canViewDashboardKpiPerson(name, user.role as UserRole, user.section_permissions),
                )
                if (first) prefetchDashboardKpiPerson(first, kpiFilterDefaults)
              }}
              trigger={['click']}
              menu={{ items: dashboardKpiMenuItems, className: 'kpi-header-dropdown-menu' }}
              placement="bottomLeft"
              overlayClassName="kpi-header-dropdown"
            >
              <Button type="default" icon={<DashboardOutlined />} className="kpi-header-trigger-btn">
                Dashboard - KPI
              </Button>
            </Dropdown>
          </ContextMenuTarget>
        ) : null}
        {!hideAddNew && onAddNew && (
          <ContextMenuTarget openHref={supportTicketHref} openLabel="Submit Support Ticket">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={onAddNew}
              style={{ fontWeight: 500 }}
              className="submit-btn"
            >
              <span className="submit-btn-text">Submit Support Ticket</span>
            </Button>
          </ContextMenuTarget>
        )}
        <Dropdown
          trigger={['click']}
          onOpenChange={(open) => {
            void handleStage2BellOpen(open)
          }}
          dropdownRender={() => (
            <div
              style={{
                background: '#fff',
                borderRadius: 8,
                boxShadow: '0 6px 16px rgba(0,0,0,0.08)',
                minWidth: 320,
                maxWidth: 400,
                maxHeight: 400,
                overflow: 'auto',
              }}
            >
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontWeight: 600 }}>
                Stage 2 remarks
                <Text type="secondary" style={{ fontSize: 11, fontWeight: 400, display: 'block', marginTop: 2 }}>
                  Support · Chores &amp; Bugs · last 24 hours
                </Text>
              </div>
              {stage2Notifications.length === 0 ? (
                <div style={{ padding: 24, color: '#8c8c8c', textAlign: 'center' }}>
                  No new Stage 2 remarks in the last 24 hours.
                </div>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {stage2Notifications.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => openStage2Ticket(item)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          border: 'none',
                          borderBottom: '1px solid #f0f0f0',
                          background: 'transparent',
                          padding: '10px 16px',
                          cursor: 'pointer',
                        }}
                      >
                        <Text strong style={{ color: '#4A6BFF' }}>
                          {item.reference_no || '—'}
                        </Text>
                        <div style={{ fontSize: 12, color: '#595959', marginTop: 4 }}>{item.remark_text}</div>
                        <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 4 }}>
                          {item.added_by_name ? `${item.added_by_name} · ` : ''}
                          {item.added_at ? dayjs(item.added_at).fromNow() : ''}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        >
          <Badge count={stage2NotifyCount || 0} size="small" offset={[-2, 2]} overflowCount={99} showZero={false}>
            <Button
              type="text"
              icon={<BellOutlined />}
              style={{ fontSize: 18 }}
              aria-label="Stage 2 remark notifications"
            />
          </Badge>
        </Dropdown>
        <Space>
          <div style={{ textAlign: 'right' }}>
            <Text strong style={{ display: 'block', color: '#4A6BFF' }}>{user?.full_name}</Text>
          </div>
          <Dropdown menu={{ items: menuItems }} placement="bottomRight">
            <Avatar
              style={{ backgroundColor: '#4A6BFF', cursor: 'pointer' }}
              icon={user?.avatar_url ? undefined : <UserOutlined />}
              src={user?.avatar_url}
            >
              {!user?.avatar_url && user?.full_name ? getInitials(user.full_name) : null}
            </Avatar>
          </Dropdown>
        </Space>
      </Space>
      <ImprovementSuggestionModal open={improvementOpen} onClose={() => setImprovementOpen(false)} />
      {canImprovementI1 ? (
        <ImprovementI1AdminModal open={i1Open} onClose={() => setI1Open(false)} />
      ) : null}
    </AntHeader>
  )
}
