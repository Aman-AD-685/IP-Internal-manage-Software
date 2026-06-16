import { useState } from 'react'
import { Form, Input, Button, Alert, Typography, message } from 'antd'
import { MailOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { authApi } from '../../api/auth'
import { validateEmail } from '../../utils/validation'
import { AuthLayout } from '../../components/auth/AuthLayout'
import { ROUTES } from '../../utils/constants'
import { clearStoredRecoveryAccessToken } from '../../utils/recoveryAuth'

const { Text } = Typography

export const ForgotPassword = () => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onFinish = async (values: { email: string }) => {
    clearStoredRecoveryAccessToken()
    setLoading(true)
    setError(null)
    const res = await authApi.forgotPasswordLookup(values.email.trim())
    setLoading(false)
    if (res.error) {
      setError(res.error.message)
      message.error(res.error.message)
      return
    }
    setSent(true)
    message.success(res.data?.message || 'Check your email for a password reset link.')
  }

  return (
    <AuthLayout variant="login">
      <div className="auth-card">
        <h1 className="auth-title">Forgot password</h1>
        <Text className="auth-subtitle">
          Enter your account email. We will send a secure reset link from Industryprime.
          Check inbox and junk folder — use the link once within 1 hour.
        </Text>

        {sent && (
          <Alert
            type="success"
            showIcon
            message="Check your email"
            description="Look for an email from Industryprime with subject “password reset”. Open the link once, then set your new password."
          />
        )}

        {error && (
          <Alert type="error" showIcon message={error} closable onClose={() => setError(null)} />
        )}

        {!sent && (
          <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
            <Form.Item
              name="email"
              rules={[
                { required: true, message: 'Enter your email' },
                {
                  validator: (_, value) => {
                    if (!value) return Promise.reject(new Error('Enter your email'))
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
                autoComplete="email"
              />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button
                type="primary"
                htmlType="submit"
                block
                size="large"
                loading={loading}
                className="auth-btn-primary"
              >
                Send reset link
              </Button>
            </Form.Item>
          </Form>
        )}

        <Link to={ROUTES.LOGIN} className="auth-footer-link">
          Back to Sign in
        </Link>
      </div>
    </AuthLayout>
  )
}
