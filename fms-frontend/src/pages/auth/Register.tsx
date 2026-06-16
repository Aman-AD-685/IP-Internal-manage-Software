import { useState, useEffect } from "react"
import { Form, Input, Button, Typography, message } from "antd"
import { UserOutlined, MailOutlined, LockOutlined } from "@ant-design/icons"
import { useNavigate, Link } from "react-router-dom"
import { authApi } from "../../api/auth"
import { validateEmail } from "../../utils/validation"
import { getPasswordStrength } from "../../utils/passwordStrength"
import { AuthLayout } from "../../components/auth/AuthLayout"
import { ROUTES } from "../../utils/constants"
import type { RegisterRequest } from "../../types/auth"

const { Text } = Typography

export const Register = () => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [registeredEmail, setRegisteredEmail] = useState("")
  const [resendLoading, setResendLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => navigate(ROUTES.LOGIN), 5000)
      return () => clearTimeout(timer)
    }
  }, [success, navigate])

  const onFinish = async (values: RegisterRequest) => {
    if (!values.email || !values.password || !values.full_name) {
      message.error("Please fill in all fields")
      return
    }
    setLoading(true)
    try {
      const response = await authApi.register(values)
      if (response?.error) {
        const displayMsg = response.error.code === '500'
          ? `${response.error.message} (Backend error)`
          : response.error.message
        message.error(displayMsg, 10)
        setLoading(false)
        return
      }
      if (response?.data) {
        setRegisteredEmail(response.data.email || values.email)
        message.success(response.data.message || "Registration successful! Please check your email.")
        setSuccess(true)
        form.resetFields()
      } else {
        message.error("Unexpected response from server. Please try again.")
      }
    } catch (err: any) {
      const detail = err.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : err.message || "Something went wrong"
      message.error(msg, 8)
    } finally {
      setLoading(false)
    }
  }

  const onFinishFailed = () => {
    message.error("Please fix the form errors before submitting")
  }

  if (success) {
    return (
      <AuthLayout variant="register">
        <div className="auth-card auth-success-panel">
          <h1 className="auth-title">Registration successful</h1>
          <Text className="auth-success-text">Check your email for a confirmation link.</Text>
          <Text className="auth-success-text">
            Click the link to activate your account, then sign in.
          </Text>
          <Text className="auth-success-muted">Redirecting to sign in in 5 seconds…</Text>
          {registeredEmail && (
            <Button
              type="link"
              loading={resendLoading}
              style={{ color: '#60a5fa', padding: 0 }}
              onClick={async () => {
                setResendLoading(true)
                try {
                  const res = await authApi.resendConfirmation(registeredEmail)
                  message.success(res?.message || "Email resent. Check inbox and spam.")
                } catch (e: any) {
                  message.error(e.response?.data?.detail || "Failed to resend.")
                } finally {
                  setResendLoading(false)
                }
              }}
            >
              Didn't receive the email? Resend
            </Button>
          )}
          <Link to={ROUTES.LOGIN} className="auth-footer-link">
            Back to Sign in
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout variant="register">
      <div className="auth-card auth-card--wide">
        <h1 className="auth-title">Sign up</h1>
        <p className="auth-subtitle">Create your Industryprime FMS account</p>

        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          onFinishFailed={onFinishFailed}
          autoComplete="off"
          requiredMark={false}
        >
          <Form.Item
            name="full_name"
            rules={[
              { required: true, message: "Please enter your name" },
              { min: 2, message: "Minimum 2 characters" },
            ]}
          >
            <Input prefix={<UserOutlined />} placeholder="Your name" size="large" />
          </Form.Item>

          <Form.Item
            name="email"
            rules={[
              { required: true, message: "Please enter your email" },
              {
                validator: (_, value) =>
                  !value || validateEmail(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error("Enter a valid email")),
              },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="Your e-mail" size="large" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[
              { required: true, message: "Please create a password" },
              {
                validator: (_, value) => {
                  if (!value) return Promise.reject(new Error("Please create a password"))
                  if (value.length < 8) return Promise.reject(new Error("At least 8 characters"))
                  if (!/[a-z]/.test(value)) return Promise.reject(new Error("One lowercase letter"))
                  if (!/[A-Z]/.test(value)) return Promise.reject(new Error("One uppercase letter"))
                  if (!/\d/.test(value)) return Promise.reject(new Error("One number"))
                  if (!/[@$!%*?&]/.test(value)) return Promise.reject(new Error("One special char (@$!%*?&)"))
                  return Promise.resolve()
                },
              },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Create password" size="large" />
          </Form.Item>

          <Form.Item noStyle dependencies={['password']}>
            {() => {
              const pwd = form.getFieldValue('password') || ''
              const s = getPasswordStrength(pwd)
              return pwd ? (
                <div style={{ marginBottom: 18 }}>
                  <span className="auth-strength-label">Password strength</span>
                  <div className="auth-strength-track">
                    <div
                      style={{
                        height: '100%',
                        width: `${s * 33.33}%`,
                        background: s <= 1 ? '#ef4444' : s <= 2 ? '#f59e0b' : '#22c55e',
                        borderRadius: 3,
                        transition: 'width 0.2s',
                      }}
                    />
                  </div>
                </div>
              ) : null
            }}
          </Form.Item>

          <Form.Item style={{ marginBottom: 12 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              size="large"
              loading={loading}
              className="auth-btn-primary"
            >
              Sign Up
            </Button>
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button block size="large" className="auth-btn-secondary" onClick={() => navigate(ROUTES.LOGIN)}>
              Sign in
            </Button>
          </Form.Item>
        </Form>
      </div>
    </AuthLayout>
  )
}
