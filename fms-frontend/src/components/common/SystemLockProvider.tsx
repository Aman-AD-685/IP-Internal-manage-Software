import {

  createContext,

  useCallback,

  useContext,

  useEffect,

  useMemo,

  useState,

  type ReactNode,

} from 'react'

import { Button, Typography } from 'antd'

import { LockOutlined, ReloadOutlined } from '@ant-design/icons'

import { useAuth } from '../../hooks/useAuth'

import { useRole } from '../../hooks/useRole'

import { ROLES } from '../../utils/constants'

import {

  systemLockApi,

  type SystemLockStatus,

  SYSTEM_LOCK_CHANGED_EVENT,
  LOCK_STATUS_STORAGE_KEY,
  readCachedSystemLockStatus,
  writeCachedSystemLockStatus,

} from '../../api/systemLock'

import { sessionApiCacheClearAll } from '../../utils/sessionApiCache'



const { Paragraph, Text, Title } = Typography



const POLL_MS = 5_000



const emptyStatus: SystemLockStatus = {

  is_locked: false,

  reason: null,

  locked_by: null,

  locked_by_name: null,

  locked_at: null,

  unlocked_at: null,

  updated_at: null,

}



type SystemLockContextValue = {

  status: SystemLockStatus

  isBlocked: boolean

  lockReady: boolean

  refresh: () => Promise<void>

  refreshing: boolean

}



const SystemLockContext = createContext<SystemLockContextValue>({

  status: emptyStatus,

  isBlocked: false,

  lockReady: true,

  refresh: async () => {},

  refreshing: false,

})



export function useSystemLock() {

  return useContext(SystemLockContext)

}



function SystemLockScreen({

  reason,

  onRefresh,

  refreshing,

}: {

  reason: string | null

  onRefresh: () => void

  refreshing?: boolean

}) {

  return (

    <div

      role="dialog"

      aria-modal="true"

      aria-labelledby="system-lock-title"

      style={{

        position: 'fixed',

        inset: 0,

        zIndex: 99999,

        background: 'rgba(2, 6, 23, 0.98)',

        display: 'flex',

        alignItems: 'center',

        justifyContent: 'center',

        padding: 24,

      }}

    >

      <div

        style={{

          background: '#ffffff',

          borderRadius: 12,

          padding: '32px 28px',

          maxWidth: 520,

          width: '100%',

          boxShadow: '0 24px 48px rgba(0,0,0,0.35)',

        }}

      >

        <Title level={4} id="system-lock-title" style={{ marginTop: 0, marginBottom: 16 }}>
          <LockOutlined style={{ color: '#ef4444', marginRight: 8 }} />
          System under maintance
        </Title>

        <Paragraph style={{ marginBottom: 20 }}>
          <Text strong>Reason:</Text>
          <br />
          <Text>{reason?.trim() || 'No reason provided.'}</Text>
        </Paragraph>

        <Paragraph type="secondary" style={{ marginBottom: 24 }}>
          Please wait.
        </Paragraph>

        <Button
          type="primary"
          icon={<ReloadOutlined />}
          onClick={onRefresh}
          loading={refreshing}
          block
          size="large"
          style={{
            background: '#f59e0b',
            borderColor: '#f59e0b',
            color: '#1e293b',
            fontWeight: 600,
          }}
        >
          Refresh Status
        </Button>

      </div>

    </div>

  )

}



function applyStatus(

  data: SystemLockStatus,

  setStatus: (s: SystemLockStatus) => void,

  wasBlockedRef: { current: boolean }

) {

  setStatus(data)

  writeCachedSystemLockStatus(data)

  const blocked = Boolean(data.is_locked)

  if (blocked && !wasBlockedRef.current) {

    sessionApiCacheClearAll()

  }

  wasBlockedRef.current = blocked

}



export function SystemLockProvider({ children }: { children: ReactNode }) {

  const { isAuthenticated, user } = useAuth()

  const { isMasterAdmin } = useRole()

  const wasBlockedRef = useMemo(() => ({ current: false }), [])

  const initialCache = readCachedSystemLockStatus()

  const [status, setStatus] = useState<SystemLockStatus>(() => initialCache ?? emptyStatus)

  const [lockReady, setLockReady] = useState(true)

  const [refreshing, setRefreshing] = useState(false)



  const refresh = useCallback(async () => {

    if (!isAuthenticated) {

      setStatus(emptyStatus)

      writeCachedSystemLockStatus(emptyStatus)

      setLockReady(true)

      return

    }

    if (isMasterAdmin) {

      setLockReady(true)

      try {

        const data = await systemLockApi.getStatus()

        applyStatus(data, setStatus, wasBlockedRef)

      } catch {

        /* master admin keeps working */

      }

      return

    }



    setRefreshing(true)

    try {

      const data = await systemLockApi.getStatus()

      applyStatus(data, setStatus, wasBlockedRef)

    } catch {

      const cached = readCachedSystemLockStatus()

      if (cached?.is_locked) {

        applyStatus(cached, setStatus, wasBlockedRef)

      }

    } finally {

      setRefreshing(false)

      setLockReady(true)

    }

  }, [isAuthenticated, isMasterAdmin, wasBlockedRef])



  useEffect(() => {

    if (initialCache?.is_locked && isAuthenticated && !isMasterAdmin) {

      sessionApiCacheClearAll()

      wasBlockedRef.current = true

    }

  }, [initialCache?.is_locked, isAuthenticated, isMasterAdmin, wasBlockedRef])



  useEffect(() => {

    if (!isAuthenticated) {

      setStatus(emptyStatus)

      setLockReady(true)

      wasBlockedRef.current = false

      return

    }



    if (isMasterAdmin) {

      setLockReady(true)

      void refresh()

      const pollId = window.setInterval(() => void refresh(), POLL_MS)

      return () => window.clearInterval(pollId)

    }



    const cached = readCachedSystemLockStatus()

    if (cached?.is_locked) {
      applyStatus(cached, setStatus, wasBlockedRef)
    }

    void refresh()

    const pollId = window.setInterval(() => void refresh(), POLL_MS)

    const onFocus = () => void refresh()

    const onVisibility = () => {

      if (document.visibilityState === 'visible') void refresh()

    }

    const onChanged = (e: Event) => {

      const detail = (e as CustomEvent<SystemLockStatus>).detail

      if (detail && typeof detail === 'object' && typeof detail.is_locked === 'boolean') {

        applyStatus(detail, setStatus, wasBlockedRef)

        setLockReady(true)

        return

      }

      void refresh()

    }

    const onStorage = (e: StorageEvent) => {

      if (e.key !== LOCK_STATUS_STORAGE_KEY || !e.newValue) return

      try {

        const parsed = JSON.parse(e.newValue) as SystemLockStatus

        if (typeof parsed?.is_locked === 'boolean') {

          applyStatus(parsed, setStatus, wasBlockedRef)

          setLockReady(true)

        }

      } catch {

        /* ignore */

      }

    }

    window.addEventListener('focus', onFocus)

    document.addEventListener('visibilitychange', onVisibility)

    window.addEventListener(SYSTEM_LOCK_CHANGED_EVENT, onChanged)

    window.addEventListener('storage', onStorage)

    return () => {

      window.clearInterval(pollId)

      window.removeEventListener('focus', onFocus)

      document.removeEventListener('visibilitychange', onVisibility)

      window.removeEventListener(SYSTEM_LOCK_CHANGED_EVENT, onChanged)

      window.removeEventListener('storage', onStorage)

    }

  }, [isAuthenticated, isMasterAdmin, refresh, wasBlockedRef])



  const isBlocked = Boolean(
    isAuthenticated && user?.role !== ROLES.MASTER_ADMIN && status.is_locked
  )

  const value = useMemo(

    () => ({ status, isBlocked, lockReady, refresh, refreshing }),

    [status, isBlocked, lockReady, refresh, refreshing]

  )



  return (

    <SystemLockContext.Provider value={value}>

      {isBlocked ? (
        <SystemLockScreen
          reason={status.reason}
          onRefresh={() => void refresh()}
          refreshing={refreshing}
        />
      ) : (
        children
      )}

    </SystemLockContext.Provider>

  )

}


