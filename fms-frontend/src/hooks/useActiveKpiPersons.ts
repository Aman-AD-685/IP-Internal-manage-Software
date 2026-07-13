import { useCallback, useEffect, useState } from 'react'
import { dashboardKpiApi, type DashboardKpiPerson } from '../api/dashboardKpi'
import { useAuth } from './useAuth'

/** Active KPI person dashboards (Users page Status = Active). */
export function useActiveKpiPersons(): readonly DashboardKpiPerson[] {
  const { user } = useAuth()
  const fromUser = user?.active_kpi_persons as DashboardKpiPerson[] | undefined
  const [persons, setPersons] = useState<readonly DashboardKpiPerson[]>(() => fromUser ?? [])

  useEffect(() => {
    if (fromUser?.length) setPersons(fromUser)
  }, [fromUser])

  const reload = useCallback(() => {
    void dashboardKpiApi
      .getActivePersons()
      .then((res) => setPersons(res.persons))
      .catch(() => {
        // ponytail: fail closed — keep last known list, never show all names on error
      })
  }, [])

  useEffect(() => {
    reload()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        dashboardKpiApi.clearActivePersonsCache()
        reload()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [reload])

  return persons
}
