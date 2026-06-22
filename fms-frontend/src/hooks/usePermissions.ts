import { useMemo } from 'react'
import type { DashboardPermissions, DashboardRole, DashboardUserContext } from '../types/dashboard'

const EMPTY_PERMISSIONS: DashboardPermissions = {
  support: false,
  success: false,
  clientToLead: false,
  onboarding: false,
  training: false,
  clientPayment: false,
  dbClient: false,
  viewKpiSuccess: false,
  manageUsers: false,
  globalFilters: false,
}

export function usePermissions(userContext: DashboardUserContext | null | undefined) {
  return useMemo(() => {
    const permissions = userContext?.permissions ?? EMPTY_PERMISSIONS
    const role: DashboardRole = userContext?.role ?? 'user'
    return {
      role,
      permissions,
      can: (section: keyof DashboardPermissions): boolean => permissions[section] === true,
    }
  }, [userContext])
}
