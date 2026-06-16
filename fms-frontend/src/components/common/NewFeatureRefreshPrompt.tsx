import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { Modal, Button, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { appReleaseApi, type AppReleaseBroadcast } from '../../api/appRelease'
import { useAuth } from '../../hooks/useAuth'
import {
  APP_RELEASE_CHECK_EVENT,
  releaseKeysMatch,
} from '../../utils/releaseKey'

const ACK_KEY = 'fms_release_acknowledged_key'
const REMIND_KEY = 'fms_release_remind_later'
/** Poll while session is open so deploys reach users who never reload. */
const POLL_MS = 12 * 1000
const REMIND_LATER_MS = 17 * 60 * 60 * 1000
const CLIENT_RELEASE_KEY = (import.meta.env.VITE_APP_RELEASE_KEY || 'dev-local').trim()
/** Burst checks after login or when restoring an existing session. */
const BURST_DELAYS_MS = [0, 500, 2000, 5000, 10000, 20000, 45000, 60000]

type RemindLaterState = {
  release_key: string
  until: number
}

function readRemindLater(): RemindLaterState | null {
  try {
    const raw = localStorage.getItem(REMIND_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RemindLaterState
    if (!parsed?.release_key || typeof parsed.until !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function isAcknowledged(serverKey: string): boolean {
  const acknowledged = localStorage.getItem(ACK_KEY)?.trim()
  return Boolean(acknowledged && releaseKeysMatch(acknowledged, serverKey))
}

function shouldShowModal(serverKey: string): boolean {
  if (isAcknowledged(serverKey)) return false
  const remind = readRemindLater()
  if (remind?.release_key && releaseKeysMatch(remind.release_key, serverKey) && remind.until > Date.now()) {
    return false
  }
  return true
}

function applyReleaseUpdate(
  data: AppReleaseBroadcast,
  setInfo: (v: AppReleaseBroadcast | null) => void,
  setShowBar: (v: boolean) => void,
  setModalOpen: (v: boolean) => void,
  lastServerKeyRef: { current: string | null }
) {
  if (!data?.is_active || !data.release_key) {
    setShowBar(false)
    setModalOpen(false)
    setInfo(null)
    return
  }

  const serverKey = data.release_key.trim()
  lastServerKeyRef.current = serverKey
  if (!serverKey || releaseKeysMatch(CLIENT_RELEASE_KEY, serverKey)) {
    setShowBar(false)
    setModalOpen(false)
    setInfo(null)
    return
  }

  if (isAcknowledged(serverKey)) {
    setShowBar(false)
    setModalOpen(false)
    setInfo(null)
    return
  }

  setInfo(data)
  setShowBar(true)
  setModalOpen(shouldShowModal(serverKey))
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
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10050,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        flexWrap: 'wrap',
        padding: '12px 20px',
        background: 'linear-gradient(90deg, #1e3a5f 0%, #2563eb 100%)',
        color: '#fff',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.2)',
      }}
    >
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <Typography.Text strong style={{ color: '#fff', display: 'block' }}>
          {title}
        </Typography.Text>
        <Typography.Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>
          {message}
        </Typography.Text>
      </div>
      <Button
        type="primary"
        size="middle"
        icon={<ReloadOutlined />}
        onClick={onRefresh}
        style={{
          background: '#f59e0b',
          borderColor: '#f59e0b',
          color: '#1e293b',
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        Refresh for new feature
      </Button>
    </div>
  )
}

/**
 * When live release_key differs from this build's embedded key, show a persistent
 * refresh bar (always visible until refresh) plus an optional first-visit modal.
 * Works for users already logged in — polls in the background after session restore.
 */
export function NewFeatureRefreshPrompt() {
  const { isAuthenticated, token } = useAuth()
  const location = useLocation()
  const sessionActive = Boolean(isAuthenticated && token)
  const [modalOpen, setModalOpen] = useState(false)
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
      applyReleaseUpdate(data, setInfo, setShowBar, setModalOpen, lastServerKeyRef)
    } finally {
      checkingRef.current = false
    }
  }, [sessionActive])

  useLayoutEffect(() => {
    if (!sessionActive) {
      setShowBar(false)
      setModalOpen(false)
      return
    }
    void checkRelease()
  }, [sessionActive, checkRelease])

  useEffect(() => {
    if (!sessionActive) {
      setShowBar(false)
      setModalOpen(false)
      return
    }

    const burstIds = BURST_DELAYS_MS.map((delay) => window.setTimeout(() => void checkRelease(), delay))
    const pollId = window.setInterval(() => void checkRelease(), POLL_MS)
    const onFocus = () => void checkRelease()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkRelease()
    }
    const onPageShow = () => void checkRelease()
    const onReleaseCheck = () => void checkRelease()

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener(APP_RELEASE_CHECK_EVENT, onReleaseCheck)

    return () => {
      burstIds.forEach((id) => window.clearTimeout(id))
      window.clearInterval(pollId)
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
      localStorage.removeItem(REMIND_KEY)
    }
    window.location.reload()
  }

  const handleLater = () => {
    const key = (info?.release_key || lastServerKeyRef.current || '').trim()
    if (key) {
      const state: RemindLaterState = {
        release_key: key,
        until: Date.now() + REMIND_LATER_MS,
      }
      localStorage.setItem(REMIND_KEY, JSON.stringify(state))
    }
    setModalOpen(false)
  }

  if (!sessionActive) return null

  const title = info?.title || 'New features are live'
  const message =
    info?.message ||
    'A new version of Industry Prime is available. Refresh to load the latest features.'

  return (
    <>
      {showBar &&
        typeof document !== 'undefined' &&
        createPortal(
          <ReleaseRefreshBar title={title} message={message} onRefresh={handleRefresh} />,
          document.body
        )}
      <Modal
        open={modalOpen}
        title={title}
        closable={false}
        maskClosable={false}
        keyboard={false}
        footer={[
          <Button key="later" type="text" onClick={handleLater}>
            Remind me later
          </Button>,
          <Button key="refresh" type="primary" icon={<ReloadOutlined />} onClick={handleRefresh}>
            Refresh for new feature
          </Button>,
        ]}
        zIndex={10100}
      >
        <Typography.Paragraph style={{ marginBottom: 0 }}>{message}</Typography.Paragraph>
      </Modal>
    </>
  )
}
