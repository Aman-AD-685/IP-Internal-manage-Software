import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { OpenAction } from '../utils/openActions'

/**
 * When URL contains ?open=<action>, run callback once and remove the param.
 * Used so "Open in new tab" on header buttons can open modals on load.
 */
export function useDeepLinkAction(
  action: OpenAction,
  onOpen: () => void,
  enabled = true,
): void {
  const location = useLocation()
  const navigate = useNavigate()
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  useEffect(() => {
    if (!enabled) return
    const params = new URLSearchParams(location.search)
    if (params.get('open') !== action) return
    onOpenRef.current()
    params.delete('open')
    const search = params.toString()
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '' },
      { replace: true },
    )
  }, [action, enabled, location.pathname, location.search, navigate])
}
