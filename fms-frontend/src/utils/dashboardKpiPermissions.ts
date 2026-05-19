import type { DashboardKpiPerson } from '../api/dashboardKpi'
import type { UserRole, SectionPermission } from '../types/auth'
import { canViewSection } from './helpers'

export const DASHBOARD_KPI_PERSON_SECTION_KEY: Record<DashboardKpiPerson, string> = {
  Shreyasi: 'dashboard_kpi_person_shreyasi',
  Rimpa: 'dashboard_kpi_person_rimpa',
  Akash: 'dashboard_kpi_person_akash',
  Adrija: 'dashboard_kpi_person_adrija',
  Soumya: 'dashboard_kpi_person_soumya',
}

const KPI_PERSON_KEY_PREFIX = 'dashboard_kpi_person_'

function hasExplicitKpiPersonGrants(sectionPermissions?: SectionPermission[]): boolean {
  if (!sectionPermissions?.length) return false
  return sectionPermissions.some(
    (p) =>
      p.section_key.startsWith(KPI_PERSON_KEY_PREFIX) &&
      (p.can_view === true || p.can_edit === true),
  )
}

/**
 * View a person KPI dashboard subsection.
 * Legacy: only `dashboard_kpi` granted with no person rows → all dashboards allowed.
 */
export function canViewDashboardKpiSubsection(
  subsectionKey: string,
  userRole: UserRole,
  sectionPermissions?: SectionPermission[],
): boolean {
  if (!canViewSection('dashboard_kpi', userRole, sectionPermissions)) return false
  if (!hasExplicitKpiPersonGrants(sectionPermissions)) return true
  return canViewSection(subsectionKey, userRole, sectionPermissions)
}

export function canViewDashboardKpiPerson(
  person: DashboardKpiPerson,
  userRole: UserRole,
  sectionPermissions?: SectionPermission[],
): boolean {
  return canViewDashboardKpiSubsection(
    DASHBOARD_KPI_PERSON_SECTION_KEY[person],
    userRole,
    sectionPermissions,
  )
}

/** Map section_key from catalog → DashboardKpiPerson when name matches API. */
export function personFromDashboardSectionKey(sectionKey: string): DashboardKpiPerson | null {
  const entry = Object.entries(DASHBOARD_KPI_PERSON_SECTION_KEY).find(([, key]) => key === sectionKey)
  return entry ? (entry[0] as DashboardKpiPerson) : null
}
