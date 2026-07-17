import { useEffect, useState } from 'react'
import { Alert } from 'antd'
import { WifiOutlined } from '@ant-design/icons'

/** Sticky banner when the device is offline — live ticket/KPI data will not refresh. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  )

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  if (!offline) return null

  return (
    <Alert
      type="warning"
      showIcon
      icon={<WifiOutlined />}
      banner
      message="You are offline"
      description="The app shell may still load, but live data (tickets, checklist, KPIs) needs an internet connection. Changes will not sync until you are back online."
      style={{ position: 'sticky', top: 0, zIndex: 1100 }}
    />
  )
}
