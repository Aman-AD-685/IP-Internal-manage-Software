import { useMemo } from 'react'
import { type DashboardKpiPerson } from '../api/dashboardKpi'
import { useAuth } from './useAuth'

/** Active KPI person dashboards (Users page Status = Active) — from login `/users/me`. */
export function useActiveKpiPersons(): readonly DashboardKpiPerson[] {
  const { user } = useAuth()
  return useMemo(
    () => (user?.active_kpi_persons as DashboardKpiPerson[] | undefined) ?? [],
    [user?.active_kpi_persons],
  )
}
