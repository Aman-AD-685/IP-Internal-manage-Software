import { useState, useEffect } from 'react'
import { Form, Input, Button, message, Alert } from 'antd'
import { MailOutlined, LockOutlined } from '@ant-design/icons'
import { useNavigate, Link } from 'react-router-dom'
import { authApi } from '../../api/auth'
import { validateEmail } from '../../utils/validation'
import { storage, checkSingleBrowserSession } from '../../utils/storage'
import { AuthLayout } from '../../components/auth/AuthLayout'
import { TurnstileWidget, isTurnstileEnabled } from '../../components/auth/TurnstileWidget'
import { AuthHoneypotField, useAuthFormOpenedMs, withAuthBotFields } from '../../components/auth/AuthBotFields'
import { ROUTES } from '../../utils/constants'
import { getDefaultLandingRoute } from '../../utils/helpers'
import { warmupAfterLogin } from '../../utils/warmupAfterLogin'
import { useAuth } from '../../hooks/useAuth'
import { API_BASE_URL } from '../../api/axios'
import { dispatchSystemLockChanged, writeCachedSystemLockStatus } from '../../api/systemLock'
import { getLocalUvicornStartCommand } from '../../utils/localBackend'
import type { LoginRequest } from '../../types/auth'

const allowPublicRegister = import.meta.env.VITE_ALLOW_PUBLIC_REGISTER !== '0'

/** User-facing copy for API / validation errors */
const INVALID_CREDENTIALS_MSG = 'Please enter valid email / password.'

function friendlyLoginError(raw: string): string {
  const s = (raw || '').toLowerCase()
  if (s.trim() === 'not found') {
    return (
      'Login API was not found (404). Another app may be on that port, or this is not the FMS backend. ' +
      `Check fms-frontend/.env — VITE_API_BASE_URL must match uvicorn (same port). Restart npm run dev after changing it. Then: ${getLocalUvicornStartCommand()}`
    )
  }
  if (s.includes('no account found') && s.includes('email')) {
    return 'No account found for this email. Check spelling or create an account.'
  }
  const isWrongLogin =
    (s.includes('invalid') &&
      (s.includes('password') || s.includes('email') || s.includes('credential'))) ||
    s.includes('invalid login') ||
    s.includes('wrong password') ||
    s.includes('incorrect password')
  if (isWrongLogin) {
    return INVALID_CREDENTIALS_MSG
  }
  if (s.includes('inactive')) {
    return 'Your account is inactive. Contact your administrator.'
  }
  if (s.includes('profile not found')) {
    return raw
  }
  return raw || INVALID_CREDENTIALS_MSG
}

export const Login = () => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const formOpenedMs = useAuthFormOpenedMs()
  const navigate = useNavigate()
  const { login, isAuthenticated, isLoading, user } = useAuth()

  // Already logged in — always land on default dashboard.
  useEffect(() => {
    if (isLoading || !isAuthenticated || !user) return
    navigate(getDefaultLandingRoute(user), { replace: true })
  }, [isLoading, isAuthenticated, user, navigate])

  const RETRY_DELAYS_MS = [8000, 25000]

  const attemptLogin = async (values: LoginRequest, retryCount = 0) => {
    setLoading(true)
    if (retryCount === 0) {
      setConnectionError(null)
      setLoginError(null)
    }
    try {
      const response = await authApi.login(values)

      if (response.error) {
        const msg = response.error.message || 'Invalid email or password'
        const isConnectionError =
          response.error.code !== '401' &&
          response.error.code !== '403' &&
          response.error.code !== '404' &&
          (response.error.code === '503' ||
            response.error.code === 'NETWORK_ERROR' ||
            (msg.includes('Cannot reach') && !msg.toLowerCase().includes('invalid login')))
        if (isConnectionError && retryCount < RETRY_DELAYS_MS.length) {
          setConnectionError(msg)
          setLoading(false)
          const delay = RETRY_DELAYS_MS[retryCount]
          message.info(`Retrying in ${delay / 1000}s (attempt ${retryCount + 2}/${RETRY_DELAYS_MS.length + 1})...`, delay / 1000)
          setTimeout(() => attemptLogin(values, retryCount + 1), delay)
          return
        }
        if (isConnectionError) {
          setConnectionError(msg)
        } else {
          const friendly = friendlyLoginError(msg)
          setLoginError(friendly)
          message.error(friendly)
        }
        return
      }

      if (response.data) {
        const { access_token, refresh_token, user, requires_otp } = response.data

        if (requires_otp || !user) {
          storage.setOTPEmail(values.email)
          navigate(ROUTES.OTP)
        } else {
          const gate = checkSingleBrowserSession(user)
          if (!gate.ok) {
            setLoginError(gate.message)
            message.error(gate.message)
            return
          }
          login(access_token, user, refresh_token ?? undefined)
          if (user.role !== 'master_admin' && response.data.system_lock?.is_locked) {
            writeCachedSystemLockStatus(response.data.system_lock)
            dispatchSystemLockChanged(response.data.system_lock)
          }
          const target = getDefaultLandingRoute(user)
          warmupAfterLogin(target)
          navigate(target, { replace: true })
        }
      }
    } catch (error: any) {
      const raw =
        error.response?.data?.detail ||
        error.response?.data?.message ||
        error.message ||
        'Login failed. Please check your credentials.'
      const errorMessage = typeof raw === 'string' ? raw : raw?.[0]?.msg || 'Login failed'
      const status = error.response?.status
      const isConnectionError =
        status !== 401 &&
        status !== 403 &&
        status !== 404 &&
        (status === 503 ||
          status === 504 ||
          error.code === 'ECONNABORTED' ||
          (errorMessage.includes('Cannot reach') && !errorMessage.toLowerCase().includes('invalid login')))
      if (isConnectionError && retryCount < RETRY_DELAYS_MS.length) {
        setConnectionError(errorMessage)
        setLoading(false)
        const delay = RETRY_DELAYS_MS[retryCount]
        message.info(`Retrying in ${delay / 1000}s (attempt ${retryCount + 2}/${RETRY_DELAYS_MS.length + 1})...`, delay / 1000)
        setTimeout(() => attemptLogin(values, retryCount + 1), delay)
        return
      }
      if (isConnectionError) {
        setConnectionError(errorMessage)
      } else {
        const friendly = friendlyLoginError(errorMessage)
        setLoginError(friendly)
        message.error(friendly)
      }
    } finally {
      setLoading(false)
    }
  }

  const onFinish = (values: LoginRequest) => {
    if (isTurnstileEnabled() && !turnstileToken) {
      message.warning('Please complete the bot check before signing in.')
      return
    }
    const payload = withAuthBotFields(
      { ...values, turnstile_token: turnstileToken || undefined },
      formOpenedMs,
    )
    attemptLogin(payload as LoginRequest, 0)
  }

  return (
    <AuthLayout variant="login">
      <div className="auth-card">
        <h1 className="auth-title">Sign in</h1>
        <p className="auth-subtitle">Welcome back</p>

        {connectionError && (
          <Alert
            type="error"
            showIcon
            message="Connection problem"
            description={
              <>
                <div style={{ marginBottom: 8 }}>{connectionError}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <Button
                    type="primary"
                    size="small"
                    onClick={() => {
                      const values = form.getFieldsValue()
                      if (values?.email && values?.password) {
                        setConnectionError(null)
                        attemptLogin(
                          withAuthBotFields(
                            { ...values, turnstile_token: turnstileToken || undefined },
                            formOpenedMs,
                          ) as LoginRequest,
                          0,
                        )
                      } else {
                        message.warning('Enter email and password first')
                      }
                    }}
                  >
                    Retry login
                  </Button>
                  <a href={`${API_BASE_URL}/health/supabase`} target="_blank" rel="noopener noreferrer">
                    Open connection diagnostic (new tab)
                  </a>
                </div>
              </>
            }
            closable
            onClose={() => setConnectionError(null)}
            style={{ marginBottom: 24 }}
          />
        )}

        {loginError && !connectionError && (
          <Alert
            type="error"
            showIcon
            message="Sign in failed"
            description={loginError}
            closable
            onClose={() => setLoginError(null)}
            style={{ marginBottom: 24 }}
          />
        )}

        <Form
          form={form}
          name="login"
          onFinish={onFinish}
          layout="vertical"
          autoComplete="off"
          requiredMark={false}
        >
          <Form.Item
            name="email"
            style={{ marginBottom: 24 }}
            rules={[
              { required: true, message: 'Please enter your email' },
              {
                validator: (_, value) => {
                  if (!value) return Promise.reject(new Error('Please enter your email'))
                  if (!validateEmail(value)) return Promise.reject(new Error('Enter a valid email address'))
                  return Promise.resolve()
                },
              },
            ]}
          >
            <Input
              prefix={<MailOutlined />}
              placeholder="Your e-mail"
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="password"
            style={{ marginBottom: 0 }}
            rules={[{ required: true, message: 'Please enter your password' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="Password"
              size="large"
            />
          </Form.Item>

          <AuthHoneypotField />

          <TurnstileWidget onToken={setTurnstileToken} />

          <div className="auth-form-actions">
            {allowPublicRegister && (
              <Button size="small" className="auth-btn-signup" onClick={() => navigate(ROUTES.REGISTER)}>
                Sign Up
              </Button>
            )}
            <Link to={ROUTES.FORGOT_PASSWORD} className="auth-link-forgot">
              Forgot password?
            </Link>
          </div>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              size="large"
              loading={loading}
              className="auth-btn-primary"
            >
              Sign in
            </Button>
          </Form.Item>
        </Form>
      </div>
    </AuthLayout>
  )
}
