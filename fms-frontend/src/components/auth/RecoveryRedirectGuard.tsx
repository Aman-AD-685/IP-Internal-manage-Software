import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ROUTES } from '../../utils/constants'
import { hasRecoveryRedirectInUrl } from '../../utils/recoveryAuth'

/** Send recovery email links to /reset-password (public — no login). */
export function RecoveryRedirectGuard() {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (location.pathname === ROUTES.RESET_PASSWORD) return
    if (!hasRecoveryRedirectInUrl()) return
    navigate(`${ROUTES.RESET_PASSWORD}${location.search}${location.hash}`, { replace: true })
  }, [location.pathname, location.search, location.hash, navigate])

  return null
}
