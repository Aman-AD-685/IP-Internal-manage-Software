import { apiClient, isLocalBackend } from './axios'
import { getLocalUvicornStartCommand } from '../utils/localBackend'
import type { ApiResponse } from '../types/common'
import type {
  RegisterRequest,
  RegisterResponse,
  LoginRequest,
  LoginResponse,
  OTPVerifyRequest,
  OTPVerifyResponse,
  User,
} from '../types/auth'

export const authApi = {
  /**
   * Register new user
   * Backend returns: { user_id, email, confirmation_sent, message }
   */
  register: async (
    data: RegisterRequest
  ): Promise<ApiResponse<RegisterResponse>> => {
    try {
      console.log('📤 Register payload:', data)

      const response = await apiClient.post<RegisterResponse>(
        '/auth/register',
        data
      )

      console.log('📥 Register response:', response.data)

      // Backend returns RegisterResponse directly
      return {
        data: response.data,
        error: undefined,
      }
    } catch (err: any) {
      console.error('❌ Register error:', err)
      console.error('Error details:', {
        status: err.response?.status,
        data: err.response?.data,
        message: err.message,
        code: err.code,
        request: err.request,
      })

      // Handle network errors (backend not reachable)
      if (err.code === 'ECONNREFUSED' || err.code === 'ERR_NETWORK' || !err.response) {
        const defaultMsg = err.message?.includes('Network Error') || err.code === 'ERR_NETWORK'
          ? 'Cannot connect to backend server.'
          : `Network Error: ${err.message || 'Backend server is not reachable'}`
        const errorMessage = isLocalBackend
          ? `${defaultMsg} Start the backend: ${getLocalUvicornStartCommand()}`
          : `${defaultMsg} The server may be down or check your connection.`

        return {
          data: undefined,
          error: {
            message: errorMessage,
            code: 'NETWORK_ERROR',
          },
        }
      }

      // Extract error message from FastAPI response (detail can be string or array)
      const rawDetail = err.response?.data?.detail
      const errorMessage =
        (typeof rawDetail === 'string' ? rawDetail : Array.isArray(rawDetail) ? rawDetail[0]?.msg : null) ||
        err.response?.data?.message ||
        err.message ||
        'Registration failed. Please try again.'

      return {
        data: undefined,
        error: {
          message: errorMessage,
          code: err.response?.status?.toString() || 'UNKNOWN',
        },
      }
    }
  },

  /**
   * Login user
   */
  login: async (
    data: LoginRequest
  ): Promise<ApiResponse<LoginResponse>> => {
    try {
      // Backend may wait on Supabase wake-up (pre-check + retries); must exceed axios default 30s
      const response = await apiClient.post<LoginResponse>(
        '/auth/login',
        data,
        { timeout: 180000 }
      )

      return {
        data: response.data,
        error: undefined,
      }
    } catch (err: any) {
      // Handle network errors (backend not reachable or timeout)
      const isNetworkError =
        err.code === 'ECONNREFUSED' ||
        err.code === 'ERR_NETWORK' ||
        err.code === 'ECONNABORTED' ||
        !err.response
      if (isNetworkError) {
        const hint = isLocalBackend
          ? `Start the backend: ${getLocalUvicornStartCommand()}`
          : 'Server may be down or check your connection.'
        const errorMessage =
          err.code === 'ECONNABORTED'
            ? (isLocalBackend
                ? `Login timed out. Is the API running? ${getLocalUvicornStartCommand()}`
                : `Login timed out (90s). ${hint}`)
            : err.message?.includes('Network Error') || err.code === 'ERR_NETWORK'
              ? `Cannot reach server. ${hint}`
              : `Connection failed: ${err.message || 'Backend not reachable'}. ${hint}`
        return {
          data: undefined,
          error: {
            message: errorMessage,
            code: 'NETWORK_ERROR',
          },
        }
      }
      const rawDetail = err.response?.data?.detail
      const msg =
        (typeof rawDetail === 'string'
          ? rawDetail
          : Array.isArray(rawDetail)
            ? rawDetail[0]?.msg || rawDetail[0]?.message
            : null) ||
        err.response?.data?.message ||
        'Login failed'
      return {
        data: undefined,
        error: {
          message: msg,
          code: err.response?.status?.toString(),
        },
      }
    }
  },

  /**
   * Request password reset email (time-limited recovery link).
   */
  forgotPasswordLookup: async (
    email: string,
    turnstile_token?: string | null,
    bot?: { website?: string | null; form_opened_ms?: number | null }
  ): Promise<ApiResponse<{ message: string }>> => {
    try {
      const response = await apiClient.post<{ message: string }>('/auth/forgot-password/lookup', {
        email,
        ...(turnstile_token ? { turnstile_token } : {}),
        website: bot?.website ?? '',
        form_opened_ms: bot?.form_opened_ms ?? undefined,
      })
      return { data: response.data, error: undefined }
    } catch (err: any) {
      const isNetworkError =
        err.code === 'ECONNREFUSED' ||
        err.code === 'ERR_NETWORK' ||
        err.code === 'ECONNABORTED' ||
        !err.response
      if (isNetworkError) {
        const hint = isLocalBackend
          ? `Start the backend: ${getLocalUvicornStartCommand()}`
          : 'Server may be down or check your connection.'
        const errorMessage =
          err.code === 'ECONNABORTED'
            ? `Request timed out. ${hint}`
            : err.message?.includes('Network Error') || err.code === 'ERR_NETWORK'
              ? `Cannot reach server. ${hint}`
              : `Connection failed: ${err.message || 'Backend not reachable'}. ${hint}`
        return {
          data: undefined,
          error: { message: errorMessage, code: 'NETWORK_ERROR' },
        }
      }
      const rawDetail = err.response?.data?.detail
      const msg =
        (typeof rawDetail === 'string'
          ? rawDetail
          : Array.isArray(rawDetail)
            ? rawDetail[0]?.msg
            : null) ||
        err.response?.data?.message ||
        'Could not request password reset'
      return {
        data: undefined,
        error: { message: msg, code: err.response?.status?.toString() },
      }
    }
  },

  /**
   * Exchange ?code= or ?token= from the email link into a recovery access_token.
   */
  recoverySession: async (payload: {
    code?: string
    token?: string
  }): Promise<ApiResponse<{ access_token: string; refresh_token?: string | null }>> => {
    try {
      const response = await apiClient.post<{ access_token: string; refresh_token?: string | null }>(
        '/auth/recovery-password/session',
        payload
      )
      return { data: response.data, error: undefined }
    } catch (err: any) {
      const rawDetail = err.response?.data?.detail
      const msg =
        typeof rawDetail === 'string'
          ? rawDetail
          : err.response?.data?.message || 'Invalid or expired reset link'
      return {
        data: undefined,
        error: { message: msg, code: err.response?.status?.toString() },
      }
    }
  },

  recoveryValidate: async (payload: {
    access_token: string
    refresh_token?: string | null
  }): Promise<ApiResponse<{ valid: boolean }>> => {
    try {
      const response = await apiClient.post<{ valid: boolean }>(
        '/auth/recovery-password/validate',
        payload
      )
      return { data: response.data, error: undefined }
    } catch (err: any) {
      const rawDetail = err.response?.data?.detail
      const msg =
        typeof rawDetail === 'string'
          ? rawDetail
          : err.response?.data?.message || 'Invalid or expired reset link'
      return {
        data: undefined,
        error: { message: msg, code: err.response?.status?.toString() },
      }
    }
  },

  /**
   * Set new password after opening email link — no login required (token in body).
   */
  recoveryPassword: async (
    recoveryAccessToken: string,
    password: string,
    refreshToken?: string | null
  ): Promise<ApiResponse<{ message: string }>> => {
    try {
      const response = await apiClient.post<{ message: string }>(
        '/auth/recovery-password/reset',
        {
          access_token: recoveryAccessToken,
          password,
          refresh_token: refreshToken ?? undefined,
        }
      )
      return { data: response.data, error: undefined }
    } catch (err: any) {
      const rawDetail = err.response?.data?.detail
      const msg =
        typeof rawDetail === 'string'
          ? rawDetail
        : err.response?.data?.message || 'Could not update password'
      return {
        data: undefined,
        error: { message: msg, code: err.response?.status?.toString() },
      }
    }
  },

  /**
   * Get current user (requires Bearer token)
   */
  getCurrentUser: async (): Promise<ApiResponse<User>> => {
    try {
      const response = await apiClient.get<User>('/users/me')
      return { data: response.data, error: undefined }
    } catch (err: any) {
      const status = err.response?.status
      const noResponse = !err.response
      const isNetwork =
        noResponse &&
        (err.code === 'ERR_NETWORK' ||
          err.code === 'ECONNREFUSED' ||
          err.code === 'ECONNABORTED' ||
          err.message === 'Network Error')
      const lockReason =
        typeof err.response?.data?.reason === 'string' ? err.response.data.reason.trim() : undefined
      return {
        data: undefined,
        error: {
          message:
            (typeof err.response?.data?.message === 'string'
              ? err.response.data.message
              : typeof err.response?.data?.detail === 'string'
                ? err.response.data.detail
                : err.message) || 'Failed to get user',
          code: isNetwork ? 'NETWORK_ERROR' : status?.toString(),
          lockReason,
        },
      }
    }
  },

  /**
   * Verify OTP (after login when requires_otp is true)
   */
  resendConfirmation: async (
    email: string,
    turnstile_token?: string | null,
    bot?: { website?: string | null; form_opened_ms?: number | null }
  ): Promise<{ success?: boolean; message?: string }> => {
    const res = await apiClient.post<{ success: boolean; message: string }>(
      '/auth/resend-confirmation',
      {
        email,
        ...(turnstile_token ? { turnstile_token } : {}),
        website: bot?.website ?? '',
        form_opened_ms: bot?.form_opened_ms ?? undefined,
      }
    )
    return res.data
  },

  verifyOTP: async (data: OTPVerifyRequest): Promise<ApiResponse<OTPVerifyResponse>> => {
    try {
      const response = await apiClient.post<OTPVerifyResponse>('/auth/verify-otp', data)
      return { data: response.data, error: undefined }
    } catch (err: any) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED' || !err.response) {
        return {
          data: undefined,
          error: {
            message: 'Unable to reach backend — please ensure the server is running',
            code: 'NETWORK_ERROR',
          },
        }
      }
      return {
        data: undefined,
        error: {
          message: err.response?.data?.detail || err.response?.data?.message || 'OTP verification failed',
          code: err.response?.status?.toString(),
        },
      }
    }
  },

  /**
   * Refresh access token using refresh_token. Use when access_token expires (401).
   * Keeps session alive without re-login (refresh tokens last ~7 days).
   */
  refresh: async (): Promise<{ access_token?: string; refresh_token?: string } | null> => {
    try {
      const refreshToken = storage.getRefreshToken()
      if (!refreshToken) return null
      const response = await apiClient.post<{ access_token: string; refresh_token: string }>(
        '/auth/refresh',
        { refresh_token: refreshToken },
        { timeout: 20000 }
      )
      return response.data
    } catch {
      return null
    }
  },

  /**
   * Logout - clears session. Backend call optional.
   */
  logout: async (accessToken?: string): Promise<void> => {
    try {
      await apiClient.post(
        '/auth/logout',
        undefined,
        accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
      )
    } catch {
      // Ignore - client clears storage anyway
    }
  },
}
