import { Menu, Drawer, Button, message } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import {
  DashboardOutlined,
  FileTextOutlined,
  RocketOutlined,
  UserOutlined,
  SettingOutlined,
  QuestionCircleOutlined,
  CheckSquareOutlined,
  SendOutlined,
  UnorderedListOutlined,
  RiseOutlined,
  LineChartOutlined,
  TeamOutlined,
  UserAddOutlined,
  AuditOutlined,
  ReadOutlined,
  StopOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import type { To } from 'react-router-dom'
import { useRole } from '../../hooks/useRole'
import { useAuth } from '../../hooks/useAuth'
import { ROUTES, canViewDbClientDbDash, canViewPendingPaymentDetails } from '../../utils/constants'
import { useState, useEffect } from 'react'
import { prefetchRouteData } from '../../utils/routePrefetch'
import { canViewSection } from '../../utils/helpers'
import type { UserRole } from '../../types/auth'
import { SoftSuggFormModal } from '../softSugg/SoftSuggFormModal'
import { SoftSuggDetailsModal } from '../softSugg/SoftSuggDetailsModal'
import { buildSupportPrefillFromSoftSuggestion, type SoftSuggestion } from '../../api/softSuggestions'
import { useContextMenuTrigger, buildNavItemMenu, buildPageSurfaceMenu } from '../../contextMenu'
import { ContextMenuTarget } from '../common/ContextMenuTarget'
import { OPEN_ACTION, buildOpenActionUrl } from '../../utils/openActions'
import { useDeepLinkAction } from '../../hooks/useDeepLinkAction'


const isSupportPage = (pathname: string) =>
  pathname.startsWith(ROUTES.TICKETS) ||
  pathname === ROUTES.STAGING ||
  pathname === ROUTES.SUPPORT_DASHBOARD

const isTaskPage = (pathname: string) =>
  pathname === ROUTES.CHECKLIST || pathname === ROUTES.DELEGATION

const isSuccessPage = (pathname: string) =>
  pathname === ROUTES.SUCCESS_DASHBOARD || pathname === ROUTES.SUCCESS_PERFORMANCE || pathname === ROUTES.SUCCESS_COMP_PERFORM || pathname === ROUTES.SU_DASH

const isClientToLeadPage = (pathname: string) =>
  pathname === ROUTES.LEADS || pathname.startsWith(ROUTES.LEADS + '/') || pathname === ROUTES.LEADS_IMPORT

const isOnboardingPage = (pathname: string) =>
  pathname.startsWith(ROUTES.ONBOARDING)

const isDbClientPage = (pathname: string) => pathname.startsWith('/db-client')

const isTrainingPage = (pathname: string) =>
  pathname.startsWith(ROUTES.TRAINING)

const isClientPaymentPage = (pathname: string) =>
  pathname === ROUTES.CLIENT_PAYMENT || pathname.startsWith(ROUTES.CLIENT_PAYMENT + '/')

interface SidebarProps {
  className?: string
  open?: boolean
  onClose?: () => void
  onOpenSupportForm?: (
    prefill: import('../forms/SupportFormModal').SupportFormPrefill,
    softSuggId: string,
  ) => void
}

export const Sidebar = ({ className, open, onClose, onOpenSupportForm }: SidebarProps) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { canAccessApproval, canAccessSettings, canAccessUsers, canViewSectionByKey, role: userRole, isMasterAdmin } =
    useRole()
  const { user } = useAuth()
  const [softSuggOpen, setSoftSuggOpen] = useState(false)
  const [suggDetailsOpen, setSuggDetailsOpen] = useState(false)
  const canSoftSugg =
    isMasterAdmin || canViewSection('soft_sugg', userRole as UserRole, user?.section_permissions)
  const canSuggDetails =
    isMasterAdmin || canViewSection('soft_sugg_details', userRole as UserRole, user?.section_permissions)

  const handleMoveToSoft = (row: SoftSuggestion) => {
    setSuggDetailsOpen(false)
    onClose?.()
    onOpenSupportForm?.(buildSupportPrefillFromSoftSuggestion(row), row.id)
  }
  const [supportOpen, setSupportOpen] = useState(isSupportPage(location.pathname))
  const [taskOpen, setTaskOpen] = useState(isTaskPage(location.pathname))
  const [successOpen, setSuccessOpen] = useState(isSuccessPage(location.pathname))
  const [clientToLeadOpen, setClientToLeadOpen] = useState(isClientToLeadPage(location.pathname))
  const [onboardingOpen, setOnboardingOpen] = useState(isOnboardingPage(location.pathname))
  const [trainingOpen, setTrainingOpen] = useState(isTrainingPage(location.pathname))
  const [dbClientOpen, setDbClientOpen] = useState(isDbClientPage(location.pathname))
  const [clientPaymentOpen, setClientPaymentOpen] = useState(isClientPaymentPage(location.pathname))
  useEffect(() => {
    if (isSupportPage(location.pathname)) setSupportOpen(true)
  }, [location.pathname])
  useEffect(() => {
    if (isClientPaymentPage(location.pathname)) setClientPaymentOpen(true)
  }, [location.pathname])
  useEffect(() => {
    if (isTaskPage(location.pathname)) setTaskOpen(true)
  }, [location.pathname])
  useEffect(() => {
    if (isSuccessPage(location.pathname)) setSuccessOpen(true)
  }, [location.pathname])
  useEffect(() => {
    if (isClientToLeadPage(location.pathname)) setClientToLeadOpen(true)
  }, [location.pathname])
  useEffect(() => {
    if (isOnboardingPage(location.pathname)) setOnboardingOpen(true)
  }, [location.pathname])
  useEffect(() => {
    if (isTrainingPage(location.pathname)) setTrainingOpen(true)
  }, [location.pathname])
  useEffect(() => {
    if (isDbClientPage(location.pathname)) setDbClientOpen(true)
  }, [location.pathname])

  const linkStyle = { color: 'inherit', display: 'block' }
  const prefetchedLabel = (key: string, to: To, text: string) => (
    <span
      data-menu-id={key}
      onMouseEnter={() => prefetchRouteData(key)}
      onFocus={() => prefetchRouteData(key)}
    >
      <Link to={to} style={linkStyle} onClick={() => prefetchRouteData(key)}>
        {text}
      </Link>
    </span>
  )
  const allSupportItems: MenuProps['items'] = [
    { key: ROUTES.SUPPORT_DASHBOARD, icon: <DashboardOutlined />, label: prefetchedLabel(ROUTES.SUPPORT_DASHBOARD, ROUTES.SUPPORT_DASHBOARD, 'Support Dashboard'), sectionKey: 'support_dashboard' },
    { key: `${ROUTES.TICKETS}?section=chores-bugs`, icon: <FileTextOutlined />, label: prefetchedLabel(`${ROUTES.TICKETS}?section=chores-bugs`, { pathname: ROUTES.TICKETS, search: 'section=chores-bugs' }, 'Chores & Bugs'), sectionKey: 'chores_bugs' },
    { key: ROUTES.STAGING, icon: <RocketOutlined />, label: prefetchedLabel(ROUTES.STAGING, ROUTES.STAGING, 'Staging'), sectionKey: 'staging' },
    { key: `${ROUTES.TICKETS}?type=feature`, icon: <FileTextOutlined />, label: prefetchedLabel(`${ROUTES.TICKETS}?type=feature`, `${ROUTES.TICKETS}?type=feature`, 'Feature'), sectionKey: 'feature' },
    { key: `${ROUTES.TICKETS}?type=feature&view=approval`, icon: <FileTextOutlined />, label: prefetchedLabel(`${ROUTES.TICKETS}?type=feature&view=approval`, `${ROUTES.TICKETS}?type=feature&view=approval`, 'Approval Status'), sectionKey: 'approval_status' },
    {
      key: `${ROUTES.TICKETS}?section=register-of-tickets`,
      icon: <FileTextOutlined />,
      label: prefetchedLabel(
        `${ROUTES.TICKETS}?section=register-of-tickets`,
        `${ROUTES.TICKETS}?section=register-of-tickets`,
        'Register of Tickets',
      ),
    },
  ]
  const supportItems: MenuProps['items'] = allSupportItems?.filter((item) => {
    const key = item?.key as string
    const sectionKey = (item as { sectionKey?: string })?.sectionKey
    if (sectionKey && !canViewSectionByKey(sectionKey)) return false
    if (
      key === `${ROUTES.TICKETS}?section=register-of-tickets` &&
      !(
        canViewSectionByKey('completed_chores_bugs') ||
        canViewSectionByKey('rejected_tickets') ||
        canViewSectionByKey('completed_feature')
      )
    ) {
      return false
    }
    if (key?.includes('view=approval')) return canAccessApproval
    return true
  }) ?? []

  const taskItems: MenuProps['items'] = [
    { key: ROUTES.CHECKLIST, icon: <CheckSquareOutlined />, label: prefetchedLabel(ROUTES.CHECKLIST, ROUTES.CHECKLIST, 'Checklist') },
    { key: ROUTES.DELEGATION, icon: <SendOutlined />, label: prefetchedLabel(ROUTES.DELEGATION, ROUTES.DELEGATION, 'Delegation') },
  ]

  const successItems: MenuProps['items'] = [
    { key: ROUTES.SU_DASH, icon: <DashboardOutlined />, label: prefetchedLabel(ROUTES.SU_DASH, ROUTES.SU_DASH, 'Su -Dash'), sectionKey: 'success_performance' },
    { key: ROUTES.SUCCESS_PERFORMANCE, icon: <LineChartOutlined />, label: prefetchedLabel(ROUTES.SUCCESS_PERFORMANCE, ROUTES.SUCCESS_PERFORMANCE, 'Performance Monitoring'), sectionKey: 'success_performance' },
    { key: ROUTES.SUCCESS_COMP_PERFORM, icon: <LineChartOutlined />, label: prefetchedLabel(ROUTES.SUCCESS_COMP_PERFORM, ROUTES.SUCCESS_COMP_PERFORM, 'Comp- Perform'), sectionKey: 'success_comp_perform' },
  ]
  const filteredSuccessItems: MenuProps['items'] = successItems?.filter((item) => {
    const sectionKey = (item as { sectionKey?: string })?.sectionKey
    if (sectionKey && !canViewSectionByKey(sectionKey)) return false
    return true
  }) ?? []

  const onboardingItems: MenuProps['items'] = [
    { key: ROUTES.ONBOARDING_PAYMENT_STATUS, icon: <FileTextOutlined />, label: prefetchedLabel(ROUTES.ONBOARDING_PAYMENT_STATUS, ROUTES.ONBOARDING_PAYMENT_STATUS, 'Record of Onboarding') },
  ]

  const trainingItems: MenuProps['items'] = [
    { key: ROUTES.TRAINING_CLIENT, icon: <ReadOutlined />, label: prefetchedLabel(ROUTES.TRAINING_CLIENT, ROUTES.TRAINING_CLIENT, 'Client Training') },
  ]

  const dbClientItems: MenuProps['items'] = [
    ...(canViewDbClientDbDash(user?.email)
      ? [
          {
            key: ROUTES.DB_CLIENT_DB_DASH,
            icon: <DashboardOutlined />,
            label: prefetchedLabel(ROUTES.DB_CLIENT_DB_DASH, ROUTES.DB_CLIENT_DB_DASH, 'DB- Dash'),
          },
        ]
      : []),
    { key: ROUTES.DB_CLIENT_CLIENT_ONB, icon: <AuditOutlined />, label: prefetchedLabel(ROUTES.DB_CLIENT_CLIENT_ONB, ROUTES.DB_CLIENT_CLIENT_ONB, 'Client ONB') },
    {
      key: ROUTES.DB_CLIENT_CLIENT_ONB_INACTIVE,
      icon: <StopOutlined />,
      label: prefetchedLabel(ROUTES.DB_CLIENT_CLIENT_ONB_INACTIVE, ROUTES.DB_CLIENT_CLIENT_ONB_INACTIVE, 'Inactive clients'),
    },
  ]

  const canViewClientPaymentSection = canViewSectionByKey('client_payment')
  const canViewPendingPaymentPage = canViewPendingPaymentDetails(user?.email)

  const clientPaymentItems: MenuProps['items'] = [
    ...(canViewPendingPaymentPage
      ? [
          {
            key: ROUTES.CLIENT_PAYMENT_PENDING_DETAILS,
            icon: <FileTextOutlined />,
            label: prefetchedLabel(ROUTES.CLIENT_PAYMENT_PENDING_DETAILS, ROUTES.CLIENT_PAYMENT_PENDING_DETAILS, 'PENDING PAYMENT DETAILS'),
          },
        ]
      : []),
    ...(canViewClientPaymentSection
      ? [
          { key: ROUTES.CLIENT_PAYMENT, icon: <FileTextOutlined />, label: prefetchedLabel(ROUTES.CLIENT_PAYMENT, ROUTES.CLIENT_PAYMENT, 'Payment Management') },
          { key: ROUTES.CLIENT_PAYMENT_PAYMENT_AGEING, icon: <FileTextOutlined />, label: prefetchedLabel(ROUTES.CLIENT_PAYMENT_PAYMENT_AGEING, ROUTES.CLIENT_PAYMENT_PAYMENT_AGEING, 'Payment Ageing Report') },
          { key: ROUTES.CLIENT_PAYMENT_COMP_REGISTER, icon: <FileTextOutlined />, label: prefetchedLabel(ROUTES.CLIENT_PAYMENT_COMP_REGISTER, ROUTES.CLIENT_PAYMENT_COMP_REGISTER, 'Comp _ Register') },
        ]
      : []),
  ]

  const leadItems: MenuProps['items'] = [
    { key: ROUTES.LEADS, icon: <UserAddOutlined />, label: prefetchedLabel(ROUTES.LEADS, ROUTES.LEADS, 'Lead') },
    { key: ROUTES.LEADS_CLOSED, icon: <UserAddOutlined />, label: prefetchedLabel(ROUTES.LEADS_CLOSED, ROUTES.LEADS_CLOSED, 'Closed Leads') },
    { key: ROUTES.LEADS_IMPORT, icon: <FileTextOutlined />, label: prefetchedLabel(ROUTES.LEADS_IMPORT, ROUTES.LEADS_IMPORT, 'Import from sheet (Generate SQL)') },
  ]

  const showDashboard = canViewSectionByKey('dashboard')
  const hasAnySupportSection = (supportItems?.length ?? 0) > 0
  const showClientToLead = canViewSectionByKey('leads') || canViewSectionByKey('client_to_lead')
  const showOnboarding = canViewSectionByKey('onboarding') || canViewSectionByKey('onboarding_payment_status')
  const showTraining = canViewSectionByKey('training')
  const showClientPayment = canViewClientPaymentSection || canViewPendingPaymentPage
  const showDbClient = canViewSectionByKey('db_client')

  const menuItems: MenuProps['items'] = [
    ...(showDashboard ? [{ key: ROUTES.DASHBOARD, icon: <DashboardOutlined />, label: prefetchedLabel(ROUTES.DASHBOARD, ROUTES.DASHBOARD, 'Dashboard') }] : []),
    ...(hasAnySupportSection ? [{
      key: 'support',
      icon: <FileTextOutlined />,
      label: 'Support',
      children: supportItems,
      onTitleClick: () => setSupportOpen(!supportOpen),
    }] : []),
    ...(canViewSectionByKey('task') ? [{
      key: 'task',
      icon: <UnorderedListOutlined />,
      label: 'Task',
      children: taskItems,
      onTitleClick: () => setTaskOpen(!taskOpen),
    }] : []),
    ...(filteredSuccessItems.length > 0 ? [{
      key: 'success',
      icon: <RiseOutlined />,
      label: 'Success',
      children: filteredSuccessItems,
      onTitleClick: () => setSuccessOpen(!successOpen),
    }] : []),
    ...(showClientToLead
      ? [
          {
            key: 'client-to-lead',
            icon: <TeamOutlined />,
            label: 'Client to Lead',
            children: leadItems,
            onTitleClick: () => setClientToLeadOpen(!clientToLeadOpen),
          },
        ]
      : []),
    ...(showOnboarding
      ? [
          {
            key: 'onboarding',
            icon: <AuditOutlined />,
            label: 'Onboarding',
            children: onboardingItems,
            onTitleClick: () => setOnboardingOpen(!onboardingOpen),
          },
        ]
      : []),
    ...(showTraining
      ? [
          {
            key: 'training',
            icon: <ReadOutlined />,
            label: 'Training',
            children: trainingItems,
            onTitleClick: () => setTrainingOpen(!trainingOpen),
          },
        ]
      : []),
    ...(showClientPayment
      ? [
          {
            key: 'client-payment',
            icon: <FileTextOutlined />,
            label: 'Client Payment',
            children: clientPaymentItems,
            onTitleClick: () => setClientPaymentOpen(!clientPaymentOpen),
          },
        ]
      : []),
    ...(showDbClient
      ? [
          {
            key: 'db-client',
            icon: <ReadOutlined />,
            label: 'DB Client',
            children: dbClientItems,
            onTitleClick: () => {
              const next = !dbClientOpen
              setDbClientOpen(next)
              if (next && showOnboarding) setOnboardingOpen(true)
            },
          },
        ]
      : []),
    ...(canAccessUsers ? [{ key: ROUTES.USERS, icon: <UserOutlined />, label: prefetchedLabel(ROUTES.USERS, ROUTES.USERS, 'Users') }] : []),
    ...(canAccessSettings ? [{ key: ROUTES.SETTINGS, icon: <SettingOutlined />, label: prefetchedLabel(ROUTES.SETTINGS, ROUTES.SETTINGS, 'Settings') }] : []),
    {
      key: 'help',
      icon: <QuestionCircleOutlined />,
      label: 'Need Help?',
    },
  ]

  const handleMenuClick = ({ key }: { key: string }) => {
    if (key === 'help') return
    prefetchRouteData(key)
    const [path, query] = key.includes('?') ? key.split('?') : [key, '']
    navigate(query ? `${path}?${query}` : path)
    onClose?.()
  }

  const selectedKeys = Array.from(
    new Set([location.pathname, `${location.pathname}${location.search || ''}`])
  )
  const openKeys = [
    ...(supportOpen ? ['support'] : []),
    ...(taskOpen ? ['task'] : []),
    ...(successOpen ? ['success'] : []),
    ...(clientToLeadOpen ? ['client-to-lead'] : []),
    ...(onboardingOpen ? ['onboarding'] : []),
    ...(trainingOpen ? ['training'] : []),
    ...(clientPaymentOpen ? ['client-payment'] : []),
    ...(dbClientOpen ? ['db-client'] : []),
  ]

  const PARENT_KEYS = new Set([
    'support',
    'task',
    'success',
    'client-to-lead',
    'onboarding',
    'training',
    'client-payment',
    'db-client',
    'help',
  ])

  const sidebarContextMenu = useContextMenuTrigger((e) => {
    const target = e.target as HTMLElement
    const menuItem = target.closest('.ant-menu-item, .ant-menu-submenu-title')
    const routeKey =
      menuItem?.querySelector('[data-menu-id]')?.getAttribute('data-menu-id') ||
      menuItem?.getAttribute('data-menu-id') ||
      menuItem?.querySelector('a[href]')?.getAttribute('href')?.replace(window.location.origin, '') ||
      null
    if (routeKey && !PARENT_KEYS.has(routeKey)) {
      const label =
        menuItem?.querySelector('.ant-menu-title-content')?.textContent?.trim() ||
        menuItem?.textContent?.trim() ||
        routeKey
      return buildNavItemMenu(routeKey, label, {
        navigate: (path) => {
          const [p, q] = path.includes('?') ? path.split('?') : [path, '']
          navigate(q ? `${p}?${q}` : p)
          onClose?.()
        },
        onRefresh: () => window.location.reload(),
      })
    }
    return buildPageSurfaceMenu({
      title: 'Sidebar',
      onRefresh: () => window.location.reload(),
    })
  })

  const handleOpenChange = (keys: string[]) => {
    setSupportOpen(keys.includes('support'))
    setTaskOpen(keys.includes('task'))
    setSuccessOpen(keys.includes('success'))
    setClientToLeadOpen(keys.includes('client-to-lead'))
    setOnboardingOpen(keys.includes('onboarding'))
    setTrainingOpen(keys.includes('training'))
    setDbClientOpen(keys.includes('db-client'))
    setClientPaymentOpen(keys.includes('client-payment'))
    if (keys.includes('db-client') && showOnboarding) setOnboardingOpen(true)
  }

  const menuContent = (
    <>
      <Menu
        mode="inline"
        selectedKeys={selectedKeys}
        openKeys={openKeys}
        onOpenChange={handleOpenChange}
        items={menuItems}
        onClick={handleMenuClick}
        style={{
          borderRight: 0,
          background: 'transparent',
          marginTop: 8,
        }}
      />
    </>
  )

  const openSoftSugg = () => {
    if (!canSoftSugg) {
      message.warning('Enable "S - Sugg" under Users → Section permissions, then log in again.')
      return
    }
    setSoftSuggOpen(true)
  }
  const openSuggDetails = () => {
    if (!canSuggDetails) {
      message.warning('Enable "Sugg Details" under Users → Section permissions, then log in again.')
      return
    }
    setSuggDetailsOpen(true)
  }

  const softSuggHref = buildOpenActionUrl(location.pathname, location.search, OPEN_ACTION.SOFT_SUGG)
  const softSuggDetailsHref = buildOpenActionUrl(
    location.pathname,
    location.search,
    OPEN_ACTION.SOFT_SUGG_DETAILS,
  )

  useDeepLinkAction(OPEN_ACTION.SOFT_SUGG, openSoftSugg, canSoftSugg)
  useDeepLinkAction(OPEN_ACTION.SOFT_SUGG_DETAILS, openSuggDetails, canSuggDetails)

  const drawerHeader = user ? (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 0 4px',
        flexWrap: 'wrap',
        width: '100%',
      }}
    >
      <Button type="text" icon={<CloseOutlined />} onClick={onClose} aria-label="Close menu" />
      <ContextMenuTarget openHref={softSuggHref} openLabel="S - Sugg">
        <Button size="small" type="default" onClick={openSoftSugg}>
          S - Sugg
        </Button>
      </ContextMenuTarget>
      <ContextMenuTarget openHref={softSuggDetailsHref} openLabel="Sugg Details">
        <Button size="small" type="default" onClick={openSuggDetails}>
          Sugg Details
        </Button>
      </ContextMenuTarget>
    </div>
  ) : null

  return (
    <>
      <Drawer
        title={drawerHeader}
        closable={false}
        placement="left"
        open={open}
        onClose={onClose}
        width={260}
        styles={{ body: { padding: 0 } }}
      >
        <div {...sidebarContextMenu} style={{ minHeight: '100%' }}>
          {menuContent}
        </div>
      </Drawer>
      {canSoftSugg ? (
        <SoftSuggFormModal open={softSuggOpen} onClose={() => setSoftSuggOpen(false)} />
      ) : null}
      {canSuggDetails ? (
        <SoftSuggDetailsModal
          open={suggDetailsOpen}
          onClose={() => setSuggDetailsOpen(false)}
          onMoveToSoft={handleMoveToSoft}
        />
      ) : null}
    </>
  )
}
