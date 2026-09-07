import { useEffect, useState } from 'react'
import { Card, Typography, Button, Spin } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authApi } from '../../api/auth'
import { ROUTES } from '../../utils/constants'

const { Title, Text } = Typography

const CONFIRM_TYPES = new Set(['signup', 'magiclink', 'email', 'invite'])

function confirmParamsFromUrl(search: URLSearchParams, hash: string): { token: string; type: string } | null {
  const hashParams = new URLSearchParams(hash.replace(/^#/, ''))
  for (const params of [search, hashParams]) {
    const token = (params.get('token') || '').trim()
    const type = (params.get('type') || '').trim().toLowerCase()
    if (token && CONFIRM_TYPES.has(type)) return { token, type }
  }
  return null
}

export const ConfirmationSuccess = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<'confirming' | 'ok' | 'error'>('confirming')
  const [error, setError] = useState<string | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState(5)

  useEffect(() => {
    let cancelled = false
    const params = confirmParamsFromUrl(searchParams, window.location.hash)
    if (!params) {
      // GoTrue action_link already verified and redirected here with no token.
      setStatus('ok')
      return
    }
    const run = async () => {
      const res = await authApi.recoverySession({ token: params.token, type: params.type })
      if (cancelled) return
      if (res.error) {
        setError(res.error.message || 'Invalid or expired confirmation link. Request a new email from the sign-up page.')
        setStatus('error')
        return
      }
      window.history.replaceState(null, '', window.location.pathname)
      setStatus('ok')
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [searchParams])

  useEffect(() => {
    if (status !== 'ok') return
    if (remainingSeconds <= 0) {
      navigate(ROUTES.LOGIN)
      return
    }
    const timer = setInterval(() => setRemainingSeconds((s) => s - 1), 1000)
    return () => clearInterval(timer)
  }, [status, remainingSeconds, navigate])

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: '#f0f2f5',
      }}
    >
      <Card style={{ width: 400, textAlign: 'center' }}>
        {status === 'confirming' ? (
          <>
            <Spin size="large" style={{ marginBottom: 24 }} />
            <Title level={3}>Confirming your email…</Title>
            <Text type="secondary">Please wait a moment.</Text>
          </>
        ) : status === 'error' ? (
          <>
            <CloseCircleOutlined
              aria-hidden="true"
              style={{ fontSize: 64, color: '#ff4d4f', marginBottom: 24 }}
            />
            <Title level={3}>Confirmation failed</Title>
            <Text type="danger" style={{ fontSize: 16, display: 'block', marginBottom: 24 }}>
              {error}
            </Text>
            <Button type="primary" size="large" onClick={() => navigate(ROUTES.REGISTER)} style={{ width: '100%' }}>
              Back to Sign Up
            </Button>
          </>
        ) : (
          <>
            <CheckCircleOutlined
              aria-hidden="true"
              style={{ fontSize: 64, color: '#52c41a', marginBottom: 24 }}
            />
            <Title level={3}>Email Confirmed!</Title>
            <Text type="success" style={{ fontSize: 16, display: 'block', marginBottom: 16 }}>
              Your email has been successfully confirmed.
            </Text>
            <Text type="secondary" style={{ fontSize: 14, display: 'block', marginBottom: 24 }}>
              Your account is now active. You can log in to access the application.
            </Text>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 24 }}>
              Redirecting to login page in {remainingSeconds} second{remainingSeconds !== 1 ? 's' : ''}...
            </Text>
            <Button
              type="primary"
              size="large"
              onClick={() => navigate(ROUTES.LOGIN)}
              style={{ width: '100%' }}
            >
              Go to Login Now
            </Button>
          </>
        )}
      </Card>
    </div>
  )
}
