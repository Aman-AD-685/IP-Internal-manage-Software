import { useState, useEffect } from 'react'
import { Form, Input, Button, message, Alert, Modal, Typography } from 'antd'
import { MailOutlined, LockOutlined } from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import { authApi } from '../../api/auth'
import { validateEmail } from '../../utils/validation'
import { storage, checkSingleBrowserSession } from '../../utils/storage'
import { AuthLayout } from '../../components/auth/AuthLayout'
import { ROUTES } from '../../utils/constants'
import { getPostLoginPath, getRedirectFromSearch } from '../../utils/authRedirect'
import { useAuth } from '../../hooks/useAuth'
import { API_BASE_URL } from '../../api/axios'
import { getLocalUvicornStartCommand } from '../../utils/localBackend'
import type { LoginRequest } from '../../types/auth'

const { Link: TextLink } = Typography

const colors = {
  darkBlue: '#1e3a5f',
  lightBlue: '#7eb8da',
  white: '#ffffff',
  accent: '#f59e0b',
}

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
  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { login, isAuthenticated, isLoading, user } = useAuth()

  // Already logged in (e.g. opened /login?redirect=... in new tab) — go to intended page.
  useEffect(() => {
    if (isLoading || !isAuthenticated || !user) return
    navigate(getPostLoginPath(location.search, user), { replace: true })
  }, [isLoading, isAuthenticated, user, location.search, navigate])

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
          const ret = getRedirectFromSearch(location.search)
          navigate(
            ret ? `${ROUTES.OTP}?redirect=${encodeURIComponent(ret)}` : ROUTES.OTP,
          )
        } else {
          const gate = checkSingleBrowserSession(user)
          if (!gate.ok) {
            setLoginError(gate.message)
            message.error(gate.message)
            return
          }
          login(access_token, user, refresh_token ?? undefined)
          navigate(getPostLoginPath(location.search, user), { replace: true })
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

  const onFinish = (values: LoginRequest) => attemptLogin(values, 0)

  const openForgot = () => {
    const e = form.getFieldValue('email') as string | undefined
    setForgotEmail(e && validateEmail(e) ? e : '')
    setForgotOpen(true)
  }

  const closeForgot = () => {
    setForgotOpen(false)
  }

  /** Modal OK: request reset email (do not update password directly). */
  const handleForgotModalOk = async (): Promise<void> => {
    const e = (forgotEmail || '').trim()
    if (!e || !validateEmail(e)) {
      message.warning('Enter a valid email address')
      return Promise.reject()
    }
    setForgotLoading(true)
    const res = await authApi.forgotPasswordLookup(e)
    setForgotLoading(false)
    if (res.error) {
      message.error(res.error.message)
      return Promise.reject()
    }
    message.success(res.data?.message || 'Check your email for a password reset link.')
    closeForgot()
  }

  return (
    <AuthLayout variant="login">
      <div style={{ width: '100%', maxWidth: 750 }}>
        <h1 style={{ color: colors.white, fontSize: 48, fontWeight: 700, marginBottom: 48, textAlign: 'center' }}>
          Welcome back!
        </h1>

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
                        attemptLogin(values as LoginRequest, 0)
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
              prefix={<MailOutlined style={{ color: colors.lightBlue, marginRight: 8, fontSize: 20 }} />}
              placeholder="Your e-mail"
              size="large"
              style={{
                borderRadius: 15,
                padding: '16px 20px',
                background: colors.white,
                fontSize: 18,
              }}
            />
          </Form.Item>

          <Form.Item
            name="password"
            style={{ marginBottom: 8 }}
            rules={[{ required: true, message: 'Please enter your password' }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: colors.lightBlue, marginRight: 8, fontSize: 20 }} />}
              placeholder="Password"
              size="large"
              style={{
                borderRadius: 15,
                padding: '16px 20px',
                background: colors.white,
                fontSize: 18,
              }}
            />
          </Form.Item>

          <div style={{ textAlign: 'right', marginBottom: 20 }}>
            <TextLink onClick={openForgot} style={{ color: colors.lightBlue, fontSize: 15 }}>
              Forgot password?
            </TextLink>
          </div>

          <Form.Item style={{ marginBottom: 20 }}>
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
              Sign in
            </Button>
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              block
              size="large"
              onClick={() => navigate(ROUTES.REGISTER)}
              style={{
                borderRadius: 15,
                height: 56,
                fontSize: 18,
                border: `2px solid ${colors.white}`,
                color: colors.white,
                background: 'transparent',
              }}
            >
              Create account
            </Button>
          </Form.Item>
        </Form>
      </div>

      <Modal
        title="Forgot password"
        open={forgotOpen}
        onCancel={closeForgot}
        onOk={handleForgotModalOk}
        confirmLoading={forgotLoading}
        okText="Send reset email"
        destroyOnClose
        afterClose={() => {
          setForgotEmail('')
        }}
      >
        <p style={{ marginBottom: 12, color: '#666' }}>
          Enter your account email. If it exists, we will send a time-limited password reset link to your inbox.
        </p>
        <Input
          type="email"
          placeholder="Your e-mail"
          value={forgotEmail}
          onChange={(ev) => setForgotEmail(ev.target.value)}
          size="large"
          autoComplete="email"
        />
      </Modal>
    </AuthLayout>
  )
}
