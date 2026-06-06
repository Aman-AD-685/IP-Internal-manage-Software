import { useState } from 'react'
import { Form, Input, Button, Alert, Typography, message } from 'antd'
import { MailOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { authApi } from '../../api/auth'
import { validateEmail } from '../../utils/validation'
import { AuthLayout } from '../../components/auth/AuthLayout'
import { ROUTES } from '../../utils/constants'

const { Text } = Typography

const colors = {
  lightBlue: '#7eb8da',
  white: '#ffffff',
  accent: '#f59e0b',
}

export const ForgotPassword = () => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onFinish = async (values: { email: string }) => {
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
      <div style={{ width: '100%', maxWidth: 560 }}>
        <h1 style={{ color: colors.white, fontSize: 40, fontWeight: 700, marginBottom: 12, textAlign: 'center' }}>
          Reset password
        </h1>
        <Text style={{ color: colors.lightBlue, display: 'block', textAlign: 'center', marginBottom: 28 }}>
          Enter your account email. We will send a link to set a new password — no sign-in required.
        </Text>

        {sent && (
          <Alert
            type="success"
            showIcon
            message="Check your email"
            description="Open the Reset Password link in the email. It opens a separate page where you can choose a new password."
            style={{ marginBottom: 24 }}
          />
        )}

        {error && (
          <Alert type="error" showIcon message={error} style={{ marginBottom: 24 }} closable onClose={() => setError(null)} />
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
                prefix={<MailOutlined style={{ color: colors.lightBlue, marginRight: 8, fontSize: 20 }} />}
                placeholder="Your e-mail"
                size="large"
                autoComplete="email"
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
                Send reset link
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
