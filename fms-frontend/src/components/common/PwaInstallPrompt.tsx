import { useEffect, useRef, useState } from 'react'
import { Button, Card, Space, Typography } from 'antd'
import { DownloadOutlined, CloseOutlined } from '@ant-design/icons'

const { Text } = Typography
const DISMISS_KEY = 'fms:pwa-install-dismissed'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Mobile/desktop Chromium install prompt when the browser fires beforeinstallprompt. */
export function PwaInstallPrompt() {
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return
    } catch {
      /* private mode */
    }
    // Already installed as standalone — no prompt.
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    if (standalone) return

    const onBip = (e: Event) => {
      e.preventDefault()
      deferredRef.current = e as BeforeInstallPromptEvent
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', onBip)
    return () => window.removeEventListener('beforeinstallprompt', onBip)
  }, [])

  const dismiss = () => {
    setVisible(false)
    deferredRef.current = null
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  const install = async () => {
    const ev = deferredRef.current
    if (!ev) return
    await ev.prompt()
    try {
      await ev.userChoice
    } catch {
      /* ignore */
    }
    dismiss()
  }

  if (!visible) return null

  return (
    <Card
      size="small"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 1090,
        maxWidth: 320,
        boxShadow: '0 6px 24px rgba(0,0,0,0.15)',
      }}
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Text strong>Install Industry Prime</Text>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Add to your home screen for quick access. Works like an app; live data still needs internet.
        </Text>
        <Space>
          <Button type="primary" icon={<DownloadOutlined />} onClick={() => void install()}>
            Install
          </Button>
          <Button type="text" icon={<CloseOutlined />} onClick={dismiss}>
            Not now
          </Button>
        </Space>
      </Space>
    </Card>
  )
}
