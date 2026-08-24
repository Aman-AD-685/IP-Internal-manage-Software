import { Button, Space } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { useRole } from '../../hooks/useRole'
import { ROUTES } from '../../utils/constants'

export function SupportSectionTabs() {
  const navigate = useNavigate()
  const location = useLocation()
  const { canAccessApproval, canViewSectionByKey } = useRole()
  const searchParams = new URLSearchParams(location.search)
  const sectionFromUrl = searchParams.get('section') || ''
  const typeFromUrl = searchParams.get('type') || ''
  const isApprovalSection = searchParams.get('view') === 'approval' || sectionFromUrl === 'approval-status'

  const tabs = [
    {
      key: 'chores-bugs',
      label: 'Ch & Bug',
      active: sectionFromUrl === 'chores-bugs',
      visible: canViewSectionByKey('chores_bugs'),
      to: `${ROUTES.TICKETS}?section=chores-bugs`,
    },
    {
      key: 'staging',
      label: 'Stag.',
      active: location.pathname === ROUTES.STAGING,
      visible: canViewSectionByKey('staging'),
      to: ROUTES.STAGING,
    },
    {
      key: 'feature',
      label: 'Feat.',
      active: typeFromUrl === 'feature' && !isApprovalSection && sectionFromUrl !== 'completed-feature',
      visible: canViewSectionByKey('feature'),
      to: `${ROUTES.TICKETS}?type=feature`,
    },
    {
      key: 'approval-status',
      label: 'Apprv.',
      active: isApprovalSection,
      visible: canAccessApproval && canViewSectionByKey('approval_status'),
      to: `${ROUTES.TICKETS}?type=feature&view=approval`,
    },
    {
      key: 'register-of-tickets',
      label: 'Reg.',
      active: sectionFromUrl === 'register-of-tickets',
      visible:
        canViewSectionByKey('completed_chores_bugs') ||
        canViewSectionByKey('rejected_tickets') ||
        canViewSectionByKey('completed_feature'),
      to: `${ROUTES.TICKETS}?section=register-of-tickets`,
    },
  ].filter((tab) => tab.visible)

  if (!tabs.length) return null

  return (
    <Space.Compact>
      {tabs.map((tab) => (
        <Button
          key={tab.key}
          size="small"
          type={tab.active ? 'primary' : 'default'}
          onClick={() => navigate(tab.to)}
        >
          {tab.label}
        </Button>
      ))}
    </Space.Compact>
  )
}
