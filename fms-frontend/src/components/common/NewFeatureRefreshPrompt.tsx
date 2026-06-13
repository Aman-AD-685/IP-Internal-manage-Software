import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal, Button, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { appReleaseApi, type AppReleaseBroadcast } from '../../api/appRelease'

const ACK_KEY = 'fms_release_acknowledged_key'
const REMIND_KEY = 'fms_release_remind_later'
const POLL_MS = 3 * 60 * 1000
const REMIND_LATER_MS = 17 * 60 * 60 * 1000
const CLIENT_RELEASE_KEY = (import.meta.env.VITE_APP_RELEASE_KEY || 'dev-local').trim()

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
  if (acknowledged === serverKey) return false

  const remind = readRemindLater()
  if (remind?.release_key === serverKey && remind.until > Date.now()) return false

  return true
}

/**
 * When Supabase live release_key differs from this build's embedded key, prompt all users to refresh.
 */
export function NewFeatureRefreshPrompt() {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<AppReleaseBroadcast | null>(null)
  const checkingRef = useRef(false)

  const checkRelease = useCallback(async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    try {
      const data = await appReleaseApi.get()
      if (!data?.is_active || !data.release_key) return

      const serverKey = data.release_key.trim()
      if (!serverKey || serverKey === CLIENT_RELEASE_KEY) {
        setOpen(false)
        return
      }

      if (!shouldShowPrompt(serverKey)) return

      setInfo(data)
      setOpen(true)
    } finally {
      checkingRef.current = false
    }
  }, [])

  useEffect(() => {
    void checkRelease()
    const id = window.setInterval(() => void checkRelease(), POLL_MS)
    return () => window.clearInterval(id)
  }, [checkRelease])

  const handleRefresh = () => {
    if (info?.release_key) {
      localStorage.setItem(ACK_KEY, info.release_key.trim())
      localStorage.removeItem(REMIND_KEY)
    }
    window.location.reload()
  }

  const handleLater = () => {
    if (info?.release_key) {
      const state: RemindLaterState = {
        release_key: info.release_key.trim(),
        until: Date.now() + REMIND_LATER_MS,
      }
      localStorage.setItem(REMIND_KEY, JSON.stringify(state))
    }
    setOpen(false)
  }

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
