import { useCallback, useEffect, useRef, useState } from 'react'
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
const POLL_MS = 20 * 1000
const REMIND_LATER_MS = 17 * 60 * 60 * 1000
const CLIENT_RELEASE_KEY = (import.meta.env.VITE_APP_RELEASE_KEY || 'dev-local').trim()
const BURST_DELAYS_MS = [0, 3000, 10000, 20000]

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

function shouldShowPrompt(serverKey: string): boolean {
  const acknowledged = localStorage.getItem(ACK_KEY)?.trim()
  if (acknowledged && releaseKeysMatch(acknowledged, serverKey)) return false

  const remind = readRemindLater()
  if (remind?.release_key && releaseKeysMatch(remind.release_key, serverKey) && remind.until > Date.now()) {
    return false
  }

  return true
}

/**
 * When live release_key differs from this build's embedded key, prompt users to refresh.
 */
export function NewFeatureRefreshPrompt() {
  const { isAuthenticated } = useAuth()
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<AppReleaseBroadcast | null>(null)
  const checkingRef = useRef(false)
  const lastServerKeyRef = useRef<string | null>(null)

  const checkRelease = useCallback(async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    try {
      const data = await appReleaseApi.get()
      if (!data?.is_active || !data.release_key) {
        setOpen(false)
        return
      }

      const serverKey = data.release_key.trim()
      lastServerKeyRef.current = serverKey
      if (!serverKey || releaseKeysMatch(CLIENT_RELEASE_KEY, serverKey)) {
        setOpen(false)
        return
      }

      if (!shouldShowPrompt(serverKey)) {
        setOpen(false)
        return
      }

      setInfo(data)
      setOpen(true)
    } finally {
      checkingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated) {
      setOpen(false)
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
  }, [checkRelease, isAuthenticated])

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
    setOpen(false)
  }

  if (!isAuthenticated) return null

  return (
    <Modal
      open={open}
      title={info?.title || 'New features are live'}
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
      zIndex={2000}
    >
      <Typography.Paragraph>
        {info?.message ||
          'A new version of Industry Prime is available. Refresh to load the latest features.'}
      </Typography.Paragraph>
    </Modal>
  )
}
