import { useEffect, useRef } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { resolveWebSocketUrl } from '../../utils/wsUrl'
import { SYSTEM_LOCK_CHANGED_EVENT, type SystemLockStatus, writeCachedSystemLockStatus } from '../../api/systemLock'
import {
  APP_RELEASE_CHECK_EVENT,
  APP_RELEASE_WS_CONNECTED_EVENT,
  dispatchAppReleaseCheck,
} from '../../utils/releaseKey'
import type { AppReleaseBroadcast } from '../../api/appRelease'

const RECONNECT_MS = 3_000
const AUTH_RECONNECT_MS = 60_000
const PING_MS = 45_000

type WsEnvelope =
  | { type: 'hello'; system_lock?: SystemLockStatus; app_release?: AppReleaseBroadcast }
  | { type: 'system_lock_changed'; data?: SystemLockStatus }
  | { type: 'app_release_changed'; data?: AppReleaseBroadcast }
  | { type: 'pong' }

function applySystemLock(detail: SystemLockStatus | undefined) {
  if (!detail || typeof detail.is_locked !== 'boolean') return
  writeCachedSystemLockStatus(detail)
  window.dispatchEvent(new CustomEvent(SYSTEM_LOCK_CHANGED_EVENT, { detail }))
}

function applyAppRelease(detail: AppReleaseBroadcast | undefined) {
  if (detail?.release_key) {
    window.dispatchEvent(new CustomEvent(APP_RELEASE_CHECK_EVENT, { detail }))
    return
  }
  dispatchAppReleaseCheck()
}

function handleMessage(raw: string) {
  let msg: WsEnvelope
  try {
    msg = JSON.parse(raw) as WsEnvelope
  } catch {
    return
  }

  if (msg.type === 'hello') {
    applySystemLock(msg.system_lock)
    applyAppRelease(msg.app_release)
    return
  }
  if (msg.type === 'system_lock_changed') {
    applySystemLock(msg.data)
    return
  }
  if (msg.type === 'app_release_changed') {
    applyAppRelease(msg.data)
  }
}

declare global {
  interface Window {
    __FMS_WS_CONNECTED__?: boolean
  }
}

/**
 * Live WebSocket — instant system lock + release updates for logged-in users.
 * On connect / push: triggers HTTP release check (/release.json + backend).
 * HTTP polling remains fallback when disconnected.
 */
export function FmsWebSocketProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, token } = useAuth()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<number | null>(null)
  const pingRef = useRef<number | null>(null)
  const stoppedRef = useRef(false)

  useEffect(() => {
    stoppedRef.current = false

    const setWsConnected = (connected: boolean) => {
      window.__FMS_WS_CONNECTED__ = connected
      window.dispatchEvent(
        new CustomEvent(APP_RELEASE_WS_CONNECTED_EVENT, { detail: { connected } }),
      )
    }

    const cleanup = () => {
      stoppedRef.current = true
      setWsConnected(false)
      if (reconnectRef.current != null) {
        window.clearTimeout(reconnectRef.current)
        reconnectRef.current = null
      }
      if (pingRef.current != null) {
        window.clearInterval(pingRef.current)
        pingRef.current = null
      }
      const ws = wsRef.current
      wsRef.current = null
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
    }

    if (!isAuthenticated || !token) {
      cleanup()
      return cleanup
    }

    const connect = () => {
      if (stoppedRef.current) return
      const url = resolveWebSocketUrl(token)
      if (!url) return

      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setWsConnected(true)
        dispatchAppReleaseCheck()
        if (pingRef.current != null) window.clearInterval(pingRef.current)
        pingRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping')
        }, PING_MS)
      }

      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') handleMessage(ev.data)
      }

      ws.onclose = (ev) => {
        setWsConnected(false)
        if (pingRef.current != null) {
          window.clearInterval(pingRef.current)
          pingRef.current = null
        }
        if (!stoppedRef.current) {
          const authRejected = ev.code === 4401 || ev.code === 1008
          const delay = authRejected ? AUTH_RECONNECT_MS : RECONNECT_MS
          reconnectRef.current = window.setTimeout(connect, delay)
        }
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()
    return cleanup
  }, [isAuthenticated, token])

  return <>{children}</>
}
