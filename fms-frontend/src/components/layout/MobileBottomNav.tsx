import { Button } from 'antd'
import {
  DashboardOutlined,
  FileTextOutlined,
  CheckSquareOutlined,
  AppstoreOutlined,
} from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { useRole } from '../../hooks/useRole'
import { useIsMobileNav } from '../../hooks/useIsMobileNav'
import { ROUTES } from '../../utils/constants'

interface MobileBottomNavProps {
  onMore: () => void
}

function isTicketsPath(pathname: string) {
  return (
    pathname.startsWith(ROUTES.TICKETS) ||
    pathname === ROUTES.STAGING ||
    pathname === ROUTES.SUPPORT_DASHBOARD
  )
}

function isTasksPath(pathname: string) {
  return pathname === ROUTES.CHECKLIST || pathname === ROUTES.DELEGATION
}

/** Bottom tab bar on phones — Dashboard / Tickets / Tasks / More (opens full menu). */
export function MobileBottomNav({ onMore }: MobileBottomNavProps) {
  const isMobile = useIsMobileNav()
  const navigate = useNavigate()
  const location = useLocation()
  const { canViewSectionByKey } = useRole()

  if (!isMobile) return null

  const showDashboard = canViewSectionByKey('dashboard')
  const showTickets =
    canViewSectionByKey('chores_bugs') ||
    canViewSectionByKey('all_tickets') ||
    canViewSectionByKey('feature') ||
    canViewSectionByKey('support_dashboard')
  const showTasks = canViewSectionByKey('task')

  const ticketsHref = canViewSectionByKey('chores_bugs')
    ? `${ROUTES.TICKETS}?section=chores-bugs`
    : canViewSectionByKey('support_dashboard')
      ? ROUTES.SUPPORT_DASHBOARD
      : ROUTES.TICKETS

  return (
    <nav className="mobile-bottom-nav no-print" aria-label="Primary mobile navigation">
      {showDashboard ? (
        <Button
          type="text"
          className={location.pathname === ROUTES.DASHBOARD ? 'is-active' : undefined}
          icon={<DashboardOutlined />}
          onClick={() => navigate(ROUTES.DASHBOARD)}
        >
          Dashboard
        </Button>
      ) : null}
      {showTickets ? (
        <Button
          type="text"
          className={isTicketsPath(location.pathname) ? 'is-active' : undefined}
          icon={<FileTextOutlined />}
          onClick={() => navigate(ticketsHref)}
        >
          Tickets
        </Button>
      ) : null}
      {showTasks ? (
        <Button
          type="text"
          className={isTasksPath(location.pathname) ? 'is-active' : undefined}
          icon={<CheckSquareOutlined />}
          onClick={() => navigate(ROUTES.CHECKLIST)}
        >
          Tasks
        </Button>
      ) : null}
      <Button type="text" icon={<AppstoreOutlined />} onClick={onMore}>
        More
      </Button>
    </nav>
  )
}
