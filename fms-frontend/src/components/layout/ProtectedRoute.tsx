import { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { ROUTES } from '../../utils/constants'
import { buildLoginUrl } from '../../utils/authRedirect'
import type { UserRole } from '../../types/auth'
import { canViewSection, getFirstAllowedRoute } from '../../utils/helpers'

interface ProtectedRouteProps {
  children: ReactNode
  requiredRole?: UserRole
  /** User must have View on at least one of these sections (OR). Same rules as sidebar (API section_permissions). */
  sectionKeys?: string[]
  /** If set, signed-in user email must match one entry (case-insensitive). */
  emailAllowlist?: readonly string[]
}

export const ProtectedRoute = ({ children, requiredRole, sectionKeys, emailAllowlist }: ProtectedRouteProps) => {
  const { isAuthenticated, isLoading, user } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return <LoadingSpinner fullPage />
  }

  if (!isAuthenticated) {
    const returnPath = location.pathname + location.search + location.hash
    return <Navigate to={buildLoginUrl(returnPath)} replace />
  }

  if (requiredRole && user) {
    const roleHierarchy: Record<string, number> = {
      user: 1,
      approver: 2,
      admin: 3,
      master_admin: 4,
    }
    const userLevel = roleHierarchy[user.role] ?? 0
    const requiredLevel = roleHierarchy[requiredRole] ?? 0
    if (userLevel < requiredLevel) {
      const fallback = getFirstAllowedRoute(user) ?? ROUTES.ACCESS_DENIED
      return <Navigate to={fallback} replace />
    }
  }

  if (sectionKeys?.length && user) {
    const ok = sectionKeys.some((key) =>
      canViewSection(key, user.role as UserRole, user.section_permissions)
    )
    if (!ok) {
      return <Navigate to={ROUTES.ACCESS_DENIED} replace />
    }
  }

  if (emailAllowlist?.length && user) {
    const e = (user.email || '').trim().toLowerCase()
    const ok = emailAllowlist.some((a) => (a || '').trim().toLowerCase() === e)
    if (!ok) {
      return <Navigate to={ROUTES.ACCESS_DENIED} replace />
    }
  }

  return <>{children}</>
}
