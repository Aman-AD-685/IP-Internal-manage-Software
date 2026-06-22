import { Button, Space } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useRole } from '../../hooks/useRole'
import { ROUTES, canViewDbClientDbDash, canViewPendingPaymentDetails } from '../../utils/constants'

type OperationsModule = 'success' | 'client-to-lead' | 'onboarding' | 'training' | 'client-payment' | 'db-client'

type TabConfig = {
  key: string
  label: string
  to: string
  visible: boolean
  active: boolean
}

export function OperationsSectionTabs({ module }: { module: OperationsModule }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { canViewSectionByKey } = useRole()
  const searchParams = new URLSearchParams(location.search)

  const tabsByModule: Record<OperationsModule, TabConfig[]> = {
    success: [
      {
        key: 'performance',
        label: 'Performance Monitoring',
        to: ROUTES.SUCCESS_PERFORMANCE,
        visible: canViewSectionByKey('success_performance'),
        active: location.pathname === ROUTES.SUCCESS_PERFORMANCE,
      },
      {
        key: 'comp-perform',
        label: 'Comp- Perform',
        to: ROUTES.SUCCESS_COMP_PERFORM,
        visible: canViewSectionByKey('success_comp_perform'),
        active: location.pathname === ROUTES.SUCCESS_COMP_PERFORM,
      },
    ],
    'client-to-lead': [
      {
        key: 'lead',
        label: 'Lead',
        to: ROUTES.LEADS,
        visible: canViewSectionByKey('leads') || canViewSectionByKey('client_to_lead'),
        active: location.pathname === ROUTES.LEADS && searchParams.get('status') !== 'Closed',
      },
      {
        key: 'closed-leads',
        label: 'Closed Leads',
        to: ROUTES.LEADS_CLOSED,
        visible: canViewSectionByKey('leads') || canViewSectionByKey('client_to_lead'),
        active: location.pathname === ROUTES.LEADS && searchParams.get('status') === 'Closed',
      },
      {
        key: 'import',
        label: 'Import from sheet',
        to: ROUTES.LEADS_IMPORT,
        visible: canViewSectionByKey('leads') || canViewSectionByKey('client_to_lead'),
        active: location.pathname === ROUTES.LEADS_IMPORT,
      },
    ],
    onboarding: [
      {
        key: 'payment-status',
        label: 'Record of Onboarding',
        to: ROUTES.ONBOARDING_PAYMENT_STATUS,
        visible: canViewSectionByKey('onboarding') || canViewSectionByKey('onboarding_payment_status'),
        active: location.pathname === ROUTES.ONBOARDING_PAYMENT_STATUS,
      },
    ],
    training: [
      {
        key: 'client-training',
        label: 'Client Training',
        to: ROUTES.TRAINING_CLIENT,
        visible: canViewSectionByKey('training'),
        active: location.pathname === ROUTES.TRAINING_CLIENT,
      },
    ],
    'client-payment': [
      {
        key: 'pending-payment',
        label: 'PENDING PAYMENT DETAILS',
        to: ROUTES.CLIENT_PAYMENT_PENDING_DETAILS,
        visible: canViewPendingPaymentDetails(user?.email),
        active: location.pathname === ROUTES.CLIENT_PAYMENT_PENDING_DETAILS,
      },
      {
        key: 'payment-management',
        label: 'Payment Management',
        to: ROUTES.CLIENT_PAYMENT,
        visible: canViewSectionByKey('client_payment'),
        active: location.pathname === ROUTES.CLIENT_PAYMENT,
      },
      {
        key: 'payment-ageing',
        label: 'Payment Ageing Report',
        to: ROUTES.CLIENT_PAYMENT_PAYMENT_AGEING,
        visible: canViewSectionByKey('client_payment'),
        active: location.pathname === ROUTES.CLIENT_PAYMENT_PAYMENT_AGEING,
      },
      {
        key: 'comp-register',
        label: 'Comp _ Register',
        to: ROUTES.CLIENT_PAYMENT_COMP_REGISTER,
        visible: canViewSectionByKey('client_payment'),
        active: location.pathname === ROUTES.CLIENT_PAYMENT_COMP_REGISTER,
      },
    ],
    'db-client': [
      {
        key: 'db-dash',
        label: 'DB- Dash',
        to: ROUTES.DB_CLIENT_DB_DASH,
        visible: canViewDbClientDbDash(user?.email),
        active: location.pathname === ROUTES.DB_CLIENT_DB_DASH,
      },
      {
        key: 'client-onb',
        label: 'Client ONB',
        to: ROUTES.DB_CLIENT_CLIENT_ONB,
        visible: canViewSectionByKey('db_client'),
        active: location.pathname === ROUTES.DB_CLIENT_CLIENT_ONB,
      },
      {
        key: 'inactive-clients',
        label: 'Inactive clients',
        to: ROUTES.DB_CLIENT_CLIENT_ONB_INACTIVE,
        visible: canViewSectionByKey('db_client'),
        active: location.pathname === ROUTES.DB_CLIENT_CLIENT_ONB_INACTIVE,
      },
    ],
  }

  const tabs = tabsByModule[module].filter((tab) => tab.visible)
  if (!tabs.length) return null

  return (
    <Space.Compact>
      {tabs.map((tab) => (
        <Button
          key={tab.key}
          type={tab.active ? 'primary' : 'default'}
          onClick={() => navigate(tab.to)}
        >
          {tab.label}
        </Button>
      ))}
    </Space.Compact>
  )
}
