import { useEffect, useState } from 'react'
import { Form, Input, Button, Alert, Typography } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import { useNavigate, Link } from 'react-router-dom'
import { authApi } from '../../api/auth'
import { AuthLayout } from '../../components/auth/AuthLayout'
import { ROUTES } from '../../utils/constants'
import {
  clearRecoveryParamsFromUrl,
  clearStoredRecoveryAccessToken,
  parseRecoverySessionFromUrl,
  readStoredRecoverySession,
  recoveryCodeFromUrl,
  recoveryVerifyTokenFromUrl,
  saveRecoverySession,
  type RecoverySessionTokens,
} from '../../utils/recoveryAuth'

const { Text } = Typography

const colors = {
  darkBlue: '#1e3a5f',
  lightBlue: '#7eb8da',
  white: '#ffffff',
  accent: '#f59e0b',
}

export const ResetPassword = () => {
  const [form] = Form.useForm()
  const navigate = useNavigate()
  const [session, setSession] = useState<RecoverySessionTokens | null | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const validateSession = async (tokens: RecoverySessionTokens) => {
      const res = await authApi.recoveryValidate(tokens)
      if (cancelled) return false
      if (res.error || !res.data?.valid) {
        clearStoredRecoveryAccessToken()
        setSession(null)
        setError(res.error?.message || 'This reset link has expired or was already used.')
        return false
      }
      setSession(tokens)
      return true
    }

    const resolveSession = async () => {
      const direct = parseRecoverySessionFromUrl() ?? readStoredRecoverySession()
      if (direct?.access_token) {
        saveRecoverySession(direct)
        clearRecoveryParamsFromUrl()
        await validateSession(direct)
        return
      }

      const code = recoveryCodeFromUrl()
      const verifyToken = recoveryVerifyTokenFromUrl()
      if (code || verifyToken) {
        const res = await authApi.recoverySession({ code: code ?? undefined, token: verifyToken ?? undefined })
        if (cancelled) return
        if (res.error || !res.data?.access_token) {
          setSession(null)
          setError(res.error?.message || 'This reset link is invalid or has expired.')
          clearRecoveryParamsFromUrl()
          return
        }
        const tokens: RecoverySessionTokens = {
          access_token: res.data.access_token,
          refresh_token: res.data.refresh_token,
        }
        saveRecoverySession(tokens)
        clearRecoveryParamsFromUrl()
        await validateSession(tokens)
        return
      }

      if (!cancelled) setSession(null)
    }

    void resolveSession()
    return () => {
      cancelled = true
    }
  }, [])

  const onFinish = async (values: { password: string }) => {
    if (!session?.access_token) return
    setLoading(true)
    setError(null)
    const res = await authApi.recoveryPassword(
      session.access_token,
      values.password,
      session.refresh_token
    )
    setLoading(false)
    if (res.error) {
      setError(res.error.message)
      return
    }
    clearStoredRecoveryAccessToken()
    setDone(true)
    setTimeout(() => navigate(ROUTES.LOGIN), 2500)
  }

  if (session === undefined) {
    return (
      <AuthLayout variant="login">
        <Text style={{ color: colors.white }}>Loading…</Text>
      </AuthLayout>
    )
  }

  if (!session?.access_token) {
    return (
      <AuthLayout variant="login">
        <div style={{ width: '100%', maxWidth: 560, textAlign: 'center' }}>
          <h1 style={{ color: colors.white, fontSize: 28, marginBottom: 16 }}>Invalid or expired link</h1>
          {error && (
            <Alert type="error" showIcon message={error} style={{ marginBottom: 24, textAlign: 'left' }} />
          )}
          <Text style={{ color: colors.lightBlue, display: 'block', marginBottom: 16 }}>
            Reset links expire after some time. Gmail may also open the link in the background — request a fresh link and click it once.
          </Text>
          <Link to={ROUTES.FORGOT_PASSWORD} style={{ color: colors.accent, fontWeight: 600, display: 'block', marginBottom: 12 }}>
            Request a new reset link
          </Link>
          <Link to={ROUTES.LOGIN} style={{ color: colors.lightBlue }}>
            Back to Sign in
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout variant="login">
      <div style={{ width: '100%', maxWidth: 560 }}>
        <h1 style={{ color: colors.white, fontSize: 40, fontWeight: 700, marginBottom: 12, textAlign: 'center' }}>
          Set new password
        </h1>
        <Text style={{ color: colors.lightBlue, display: 'block', textAlign: 'center', marginBottom: 28 }}>
          Choose a strong password (at least 8 characters). Use the link soon after you receive the email.
        </Text>

        {done && (
          <Alert
            type="success"
            showIcon
            message="Password updated"
            description="Redirecting to sign in…"
            style={{ marginBottom: 24 }}
          />
        )}

        {error && (
          <Alert type="error" showIcon message={error} style={{ marginBottom: 24 }} closable onClose={() => setError(null)} />
        )}

        {!done && (
          <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
            <Form.Item
              name="password"
              rules={[
                { required: true, message: 'Enter a new password' },
                { min: 8, message: 'Password must be at least 8 characters' },
              ]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: colors.lightBlue, marginRight: 8, fontSize: 20 }} />}
                placeholder="New password"
                size="large"
                autoComplete="new-password"
                style={{
                  borderRadius: 15,
                  padding: '16px 20px',
                  background: colors.white,
                  fontSize: 18,
                }}
              />
            </Form.Item>
            <Form.Item
              name="confirm"
              dependencies={['password']}
              rules={[
                { required: true, message: 'Confirm your password' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('password') === value) return Promise.resolve()
                    return Promise.reject(new Error('Passwords do not match'))
                  },
                }),
              ]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: colors.lightBlue, marginRight: 8, fontSize: 20 }} />}
                placeholder="Confirm new password"
                size="large"
                autoComplete="new-password"
                style={{
                  borderRadius: 15,
                  padding: '16px 20px',
                  background: colors.white,
                  fontSize: 18,
                }}
              />
            </Form.Item>
            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                block
                size="large"
                loading={loading}
                style={{
                  background: colors.accent,
                  borderColor: colors.accent,
                  borderRadius: 15,
                  height: 56,
                  fontWeight: 600,
                  fontSize: 18,
                }}
              >
                Update password
              </Button>
            </Form.Item>
          </Form>
        )}

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Link to={ROUTES.LOGIN} style={{ color: colors.lightBlue }}>
            Back to Sign in
          </Link>
        </div>
      </div>
    </AuthLayout>
  )
}
