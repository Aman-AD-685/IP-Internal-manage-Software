import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { Button, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { appReleaseApi, type AppReleaseBroadcast } from '../../api/appRelease'
import { useAuth } from '../../hooks/useAuth'
import {
  APP_RELEASE_CHECK_EVENT,
  APP_RELEASE_WS_CONNECTED_EVENT,
  getClientReleaseKey,
  releaseKeysMatch,
} from '../../utils/releaseKey'

const ACK_KEY = 'fms_release_acknowledged_key'
/** HTTP poll when WebSocket is down (primary fallback). */
const POLL_DISCONNECTED_MS = 12 * 1000
/** Light backup poll while WS is connected (catches CDN edge cases). */
const POLL_CONNECTED_MS = 60 * 1000
const BURST_DELAYS_MS = [0, 500, 2000, 5000, 10000, 20000, 45000, 60000]

function isAcknowledged(serverKey: string): boolean {
  const acknowledged = localStorage.getItem(ACK_KEY)?.trim()
  return Boolean(acknowledged && releaseKeysMatch(acknowledged, serverKey))
}

function applyReleaseUpdate(
  data: AppReleaseBroadcast | null,
  setInfo: (v: AppReleaseBroadcast | null) => void,
  setShowBar: (v: boolean) => void,
  lastServerKeyRef: { current: string | null },
) {
  if (!data?.is_active || !data.release_key) {
    setShowBar(false)
    setInfo(null)
    return
  }

  const serverKey = data.release_key.trim()
  lastServerKeyRef.current = serverKey
  const clientKey = getClientReleaseKey()

  if (!serverKey || releaseKeysMatch(clientKey, serverKey)) {
    setShowBar(false)
    setInfo(null)
    return
  }

  if (isAcknowledged(serverKey)) {
    setShowBar(false)
    setInfo(null)
    return
  }

  setInfo(data)
  setShowBar(true)
}

function ReleaseRefreshBar({
  title,
  message,
  onRefresh,
}: {
  title: string
  message: string
  onRefresh: () => void
}) {
  return (
    <div className="fms-release-bar" role="status" aria-live="polite">
      <Button
        type="primary"
        size="small"
        icon={<ReloadOutlined />}
        onClick={onRefresh}
        className="fms-release-bar__btn"
      >
        Refresh
      </Button>
      <div className="fms-release-bar__text">
        <Typography.Text strong className="fms-release-bar__title">
          {title}
        </Typography.Text>
        <Typography.Text className="fms-release-bar__message">{message}</Typography.Text>
      </div>
    </div>
  )
}

/**
 * Logged-in users: HTTP poll /release.json + backend; WebSocket pushes instant checks.
 */
export function NewFeatureRefreshPrompt() {
  const { isAuthenticated, token } = useAuth()
  const location = useLocation()
  const sessionActive = Boolean(isAuthenticated && token)
  const [info, setInfo] = useState<AppReleaseBroadcast | null>(null)
  const [showBar, setShowBar] = useState(false)
  const [wsConnected, setWsConnected] = useState(
    () => typeof window !== 'undefined' && Boolean(window.__FMS_WS_CONNECTED__),
  )
  const checkingRef = useRef(false)
  const lastServerKeyRef = useRef<string | null>(null)

  const checkRelease = useCallback(async () => {
    if (!sessionActive) return
    if (checkingRef.current) return
    checkingRef.current = true
    try {
      const data = await appReleaseApi.getCurrent()
      applyReleaseUpdate(data, setInfo, setShowBar, lastServerKeyRef)
    } finally {
      checkingRef.current = false
    }
  }, [sessionActive])

  useLayoutEffect(() => {
    if (!sessionActive) {
      setShowBar(false)
      return
    }
    void checkRelease()
  }, [sessionActive, checkRelease])

  useEffect(() => {
    if (!sessionActive) {
      setShowBar(false)
      return
    }

    const burstIds = BURST_DELAYS_MS.map((delay) => window.setTimeout(() => void checkRelease(), delay))
    const onFocus = () => void checkRelease()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkRelease()
    }
    const onPageShow = () => void checkRelease()
    const onWsConnected = (e: Event) => {
      const connected = Boolean((e as CustomEvent<{ connected?: boolean }>).detail?.connected)
      setWsConnected(connected)
      if (connected) void checkRelease()
    }
    const onReleaseCheck = (e: Event) => {
      const detail = (e as CustomEvent<AppReleaseBroadcast>).detail
      if (detail?.release_key) {
        applyReleaseUpdate(detail, setInfo, setShowBar, lastServerKeyRef)
      }
      void checkRelease()
    }

    const pollMs = wsConnected ? POLL_CONNECTED_MS : POLL_DISCONNECTED_MS
    const pollId = window.setInterval(() => void checkRelease(), pollMs)

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener(APP_RELEASE_WS_CONNECTED_EVENT, onWsConnected)
    window.addEventListener(APP_RELEASE_CHECK_EVENT, onReleaseCheck)

    return () => {
      burstIds.forEach((id) => window.clearTimeout(id))
      window.clearInterval(pollId)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener(APP_RELEASE_WS_CONNECTED_EVENT, onWsConnected)
      window.removeEventListener(APP_RELEASE_CHECK_EVENT, onReleaseCheck)
    }
  }, [checkRelease, sessionActive, wsConnected])

  useEffect(() => {
    if (!sessionActive) return
    void checkRelease()
  }, [location.pathname, location.search, sessionActive, checkRelease])

  const handleRefresh = () => {
    const key = (info?.release_key || lastServerKeyRef.current || '').trim()
    if (key) {
      localStorage.setItem(ACK_KEY, key)
    }
    window.location.reload()
  }

  if (!sessionActive) return null

  const title = info?.title || 'New features are live'
  const message =
    info?.message || 'A new version is available. Refresh to load the latest features.'

  if (!showBar) return null

  return typeof document !== 'undefined'
    ? createPortal(
        <ReleaseRefreshBar title={title} message={message} onRefresh={handleRefresh} />,
        document.body,
      )
    : null
}
