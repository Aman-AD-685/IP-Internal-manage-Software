import { Col, Row, Select } from 'antd'
import type { DashboardPermissions, DashboardSummaryFilters } from '../../types/dashboard'
import { usePermissions } from '../../hooks/usePermissions'
import type { DashboardUserContext } from '../../types/dashboard'

const MONTH_OPTIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m) => ({
  label: m,
  value: m,
}))

const WEEK_OPTIONS = ['week 1', 'week 2', 'week 3', 'week 4', 'week 5'].map((w) => ({
  label: w,
  value: w,
}))

const SECTION_OPTIONS: Array<{ label: string; value: keyof DashboardPermissions }> = [
  { label: 'Support', value: 'support' },
  { label: 'Success', value: 'success' },
  { label: 'Client to Lead', value: 'clientToLead' },
  { label: 'Onboarding', value: 'onboarding' },
  { label: 'Training', value: 'training' },
  { label: 'Client Payment', value: 'clientPayment' },
  { label: 'DB Client', value: 'dbClient' },
]

interface GlobalFiltersProps {
  user: DashboardUserContext
  filters: DashboardSummaryFilters
  onChange: (filters: DashboardSummaryFilters) => void
}

export function GlobalFilters({ user, filters, onChange }: GlobalFiltersProps) {
  const { can } = usePermissions(user)
  const update = (patch: DashboardSummaryFilters) => onChange({ ...filters, ...patch })

  if (!can('globalFilters')) {
    return (
      <Row gutter={[12, 12]} className="universal-dashboard-filters">
        <Col xs={12} sm={8}>
          <Select
            allowClear
            placeholder="Month"
            value={filters.month}
            onChange={(month?: string) => update({ month })}
            options={MONTH_OPTIONS}
            style={{ width: '100%' }}
          />
        </Col>
        <Col xs={12} sm={8}>
          <Select
            allowClear
            placeholder="Week"
            value={filters.week}
            onChange={(week?: string) => update({ week })}
            options={WEEK_OPTIONS}
            style={{ width: '100%' }}
          />
        </Col>
      </Row>
    )
  }

  return (
    <Row gutter={[12, 12]} className="universal-dashboard-filters">
      <Col xs={24} sm={12} lg={6}>
        <Select
          allowClear
          placeholder="Company"
          value={filters.companyId}
          onChange={(companyId?: string) => update({ companyId })}
          options={user.companyIds.map((companyId) => ({ label: companyId, value: companyId }))}
          style={{ width: '100%' }}
        />
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Select
          allowClear
          placeholder="User ID"
          value={filters.userId}
          onChange={(userId?: string) => update({ userId })}
          options={[{ label: user.userId, value: user.userId }]}
          style={{ width: '100%' }}
        />
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Select
          allowClear
          placeholder="Month"
          value={filters.month}
          onChange={(month?: string) => update({ month })}
          options={MONTH_OPTIONS}
          style={{ width: '100%' }}
        />
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Select
          allowClear
          placeholder="Week"
          value={filters.week}
          onChange={(week?: string) => update({ week })}
          options={WEEK_OPTIONS}
          style={{ width: '100%' }}
        />
      </Col>
      <Col xs={24} sm={8} lg={4}>
        <Select
          allowClear
          placeholder="Section"
          value={filters.section}
          onChange={(section?: string) => update({ section })}
          options={SECTION_OPTIONS.filter((s) => can(s.value)).map((s) => ({ label: s.label, value: s.value }))}
          style={{ width: '100%' }}
        />
      </Col>
    </Row>
  )
}
