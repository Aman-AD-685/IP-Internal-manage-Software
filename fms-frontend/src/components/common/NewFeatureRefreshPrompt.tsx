import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { Button, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { appReleaseApi, type AppReleaseBroadcast } from '../../api/appRelease'
import { useAuth } from '../../hooks/useAuth'
import {
  APP_RELEASE_CHECK_EVENT,
  releaseKeysMatch,
} from '../../utils/releaseKey'

const ACK_KEY = 'fms_release_acknowledged_key'
/** Poll while session is open so deploys reach users who never reload. */
const POLL_MS = 12 * 1000
/** Backup poll when WebSocket is connected (notify may be missed). */
const POLL_WS_BACKUP_MS = 45 * 1000
const CLIENT_RELEASE_KEY = (import.meta.env.VITE_APP_RELEASE_KEY || 'dev-local').trim()
/** Burst checks after login or when restoring an existing session. */
const BURST_DELAYS_MS = [0, 500, 2000, 5000, 10000, 20000, 45000, 60000]

function isAcknowledged(serverKey: string): boolean {
  const acknowledged = localStorage.getItem(ACK_KEY)?.trim()
  return Boolean(acknowledged && releaseKeysMatch(acknowledged, serverKey))
}

function applyReleaseUpdate(
  data: AppReleaseBroadcast,
  setInfo: (v: AppReleaseBroadcast | null) => void,
  setShowBar: (v: boolean) => void,
  lastServerKeyRef: { current: string | null }
) {
  if (!data?.is_active || !data.release_key) {
    setShowBar(false)
    setInfo(null)
    return
  }

  const serverKey = data.release_key.trim()
  lastServerKeyRef.current = serverKey
  if (!serverKey || releaseKeysMatch(CLIENT_RELEASE_KEY, serverKey)) {
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
      <div className="fms-release-bar__text">
        <Typography.Text strong className="fms-release-bar__title">
          {title}
        </Typography.Text>
        <Typography.Text className="fms-release-bar__message">{message}</Typography.Text>
      </div>
      <Button
        type="primary"
        size="middle"
        icon={<ReloadOutlined />}
        onClick={onRefresh}
        className="fms-release-bar__btn"
      >
        Refresh for new feature
      </Button>
    </div>
  )
}

/**
 * When live release_key differs from this build's embedded key, show a persistent
 * bottom bar until the user refreshes. Auto-detect via WebSocket + HTTP polling.
 */
export function NewFeatureRefreshPrompt() {
  const { isAuthenticated, token } = useAuth()
  const location = useLocation()
  const sessionActive = Boolean(isAuthenticated && token)
  const [info, setInfo] = useState<AppReleaseBroadcast | null>(null)
  const [showBar, setShowBar] = useState(false)
  const checkingRef = useRef(false)
  const lastServerKeyRef = useRef<string | null>(null)

  const checkRelease = useCallback(async () => {
    if (!sessionActive) return
    if (checkingRef.current) return
    checkingRef.current = true
    try {
      const data = await appReleaseApi.get()
      if (!data) return
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
    document.body.classList.toggle('fms-release-bar-visible', showBar)
    return () => document.body.classList.remove('fms-release-bar-visible')
  }, [showBar])

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
    const onReleaseCheck = (e: Event) => {
      const detail = (e as CustomEvent<AppReleaseBroadcast>).detail
      if (detail?.release_key) {
        applyReleaseUpdate(detail, setInfo, setShowBar, lastServerKeyRef)
        return
      }
      void checkRelease()
    }

    const pollId = window.setInterval(() => void checkRelease(), POLL_MS)
    const wsBackupPollId = window.setInterval(() => {
      if (window.__FMS_WS_CONNECTED__) void checkRelease()
    }, POLL_WS_BACKUP_MS)

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener(APP_RELEASE_CHECK_EVENT, onReleaseCheck)

    return () => {
      burstIds.forEach((id) => window.clearTimeout(id))
      window.clearInterval(pollId)
      window.clearInterval(wsBackupPollId)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener(APP_RELEASE_CHECK_EVENT, onReleaseCheck)
    }
  }, [checkRelease, sessionActive])

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
    info?.message ||
    'A new version is available. Refresh to load the latest features.'

  if (!showBar) return null

  return typeof document !== 'undefined'
    ? createPortal(
        <ReleaseRefreshBar title={title} message={message} onRefresh={handleRefresh} />,
        document.body,
      )
    : null
}
