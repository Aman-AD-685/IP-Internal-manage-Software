import { useState, useEffect } from 'react'
import { Form, Button, Card, Typography, message, Space } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { authApi } from '../../api/auth'
import { OTPInput } from '../../components/forms/OTPInput'
import { storage, checkSingleBrowserSession } from '../../utils/storage'
import { ROUTES } from '../../utils/constants'
import { getPostLoginPath } from '../../utils/authRedirect'
import { useAuth } from '../../hooks/useAuth'

const { Title, Text } = Typography

export const OTPVerification = () => {
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { verifyOTP } = useAuth()

  const email = storage.getOTPEmail()

  useEffect(() => {
    if (!email) {
      // No email in storage, redirect to login
      navigate(ROUTES.LOGIN)
    }
  }, [email, navigate])

  const handleVerify = async () => {
    if (otp.length !== 4) {
      message.warning('Please enter a 4-digit OTP')
      return
    }

    if (!email) {
      message.error('Email not found. Please login again.')
      navigate(ROUTES.LOGIN)
      return
    }

    setLoading(true)
    try {
      const response = await authApi.verifyOTP({ email, otp })

      if (response.error) {
        message.error(response.error.message || 'Invalid OTP. Please try again.')
        return
      }

      if (response.data) {
        const { access_token, refresh_token, user } = response.data
        const gate = checkSingleBrowserSession(user)
        if (!gate.ok) {
          message.error(gate.message)
          return
        }
        verifyOTP(access_token, user, refresh_token ?? undefined)
        message.success('OTP verified successfully!')

        navigate(getPostLoginPath(location.search, user), { replace: true })
      }
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message ||
        'OTP verification failed. Please try again.'
      message.error(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (!email) {
      message.error('Email not found. Please login again.')
      navigate(ROUTES.LOGIN)
      return
    }

    setResendLoading(true)
    try {
      // Note: Backend should have a separate resend OTP endpoint
      // For now, user needs to go back to login
      message.info('Please go back to login page and login again to receive a new OTP.')
    } catch (error) {
      message.error('Failed to resend OTP. Please try again.')
    } finally {
      setResendLoading(false)
    }
  }

  if (!email) {
    return null
  }

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
        <Title level={2} style={{ marginBottom: 16 }}>
          Verify OTP
        </Title>

        <Text type="secondary" style={{ display: 'block', marginBottom: 32 }}>
          We've sent a 4-digit OTP to <strong>{email}</strong>
        </Text>

        <Form onFinish={handleVerify}>
          <Form.Item>
            <OTPInput
              value={otp}
              onChange={setOtp}
              disabled={loading}
            />
          </Form.Item>

          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Button
              type="primary"
              htmlType="submit"
              block
              size="large"
              loading={loading}
              disabled={otp.length !== 4}
            >
              Verify OTP
            </Button>

            <Button
              type="link"
              onClick={handleResend}
              loading={resendLoading}
              disabled={loading}
            >
              Resend OTP
            </Button>
          </Space>
        </Form>

        <div style={{ marginTop: 24 }}>
          <Text type="secondary">
            <a href={ROUTES.LOGIN}>Back to Login</a>
          </Text>
        </div>
      </Card>
    </div>
  )
}
