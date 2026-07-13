import type { DashboardKpiPerson } from '../api/dashboardKpi'
import { DASHBOARD_KPI_NAMES } from '../api/dashboardKpi'
import type { UserRole, SectionPermission } from '../types/auth'
import { canViewSection } from './helpers'

export const DASHBOARD_KPI_PERSON_SECTION_KEY: Record<DashboardKpiPerson, string> = {
  Shreyasi: 'dashboard_kpi_person_shreyasi',
  Rimpa: 'dashboard_kpi_person_rimpa',
  Akash: 'dashboard_kpi_person_akash',
  Adrija: 'dashboard_kpi_person_adrija',
  Soumya: 'dashboard_kpi_person_soumya',
  Souvik: 'dashboard_kpi_person_souvik',
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
  // Elevated roles always see every KPI person dashboard (incl. newly added ones),
  // so a brand-new dashboard needs no per-person grant or re-login.
  if (userRole === 'master_admin' || userRole === 'admin') return true
  if (!hasExplicitKpiPersonGrants(sectionPermissions)) return true
  return canViewSection(subsectionKey, userRole, sectionPermissions)
}

export function canViewDashboardKpiPerson(
  person: DashboardKpiPerson,
  userRole: UserRole,
  sectionPermissions?: SectionPermission[],
  activeKpiPersons?: readonly string[] | null,
): boolean {
  if (activeKpiPersons && !activeKpiPersons.includes(person)) return false
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

/** KPI dashboards this user may open (permission order). */
export function listAllowedKpiPersons(
  userRole: UserRole,
  sectionPermissions?: SectionPermission[],
  activeKpiPersons?: readonly string[] | null,
): DashboardKpiPerson[] {
  return DASHBOARD_KPI_NAMES.filter((person) =>
    canViewDashboardKpiPerson(person, userRole, sectionPermissions, activeKpiPersons),
  )
}

/**
 * Best KPI person for the signed-in user (email/name match, then explicit grant, then first allowed).
 * Used for force-open routes (e.g. Success dashboard) so Rimpa is not stuck on Shreyasi.
 */
export function resolveKpiPersonForUser(
  userRole: UserRole,
  sectionPermissions?: SectionPermission[],
  userEmail?: string,
  userName?: string,
  preferred?: DashboardKpiPerson | null,
  activeKpiPersons?: readonly string[] | null,
): DashboardKpiPerson | null {
  if (preferred && canViewDashboardKpiPerson(preferred, userRole, sectionPermissions, activeKpiPersons)) {
    return preferred
  }
  const haystack = `${userEmail || ''} ${userName || ''}`.toLowerCase()
  const fromIdentity = DASHBOARD_KPI_NAMES.find((person) => haystack.includes(person.toLowerCase()))
  if (fromIdentity && canViewDashboardKpiPerson(fromIdentity, userRole, sectionPermissions, activeKpiPersons)) {
    return fromIdentity
  }
  for (const person of DASHBOARD_KPI_NAMES) {
    const key = DASHBOARD_KPI_PERSON_SECTION_KEY[person]
    const grant = sectionPermissions?.find((p) => p.section_key === key)
    if ((grant?.can_view || grant?.can_edit) && canViewDashboardKpiPerson(person, userRole, sectionPermissions, activeKpiPersons)) {
      return person
    }
  }
  return listAllowedKpiPersons(userRole, sectionPermissions, activeKpiPersons)[0] ?? null
}
