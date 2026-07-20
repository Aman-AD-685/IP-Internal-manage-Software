export type UserRole = 'user' | 'admin' | 'master_admin' | 'approver'

export interface SectionPermission {
  section_key: string
  can_view: boolean
  can_edit: boolean
}

export interface User {
  id: string
  email: string
  full_name: string
  display_name?: string
  avatar_url?: string
  role: UserRole
  is_active: boolean
  created_at: string
  last_login?: string
  /** Per-section view/edit permissions (Master Admin sets these) */
  section_permissions?: SectionPermission[]
  /** KPI person dashboards with Active user_profiles (hidden when Status = Inactive) */
  active_kpi_persons?: string[]
}

export interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
}

export interface RegisterRequest {
  email: string
  password: string
  full_name: string
  turnstile_token?: string | null
}

export interface RegisterResponse {
  user_id: string
  email: string
  confirmation_sent: boolean
  message: string
}

export interface LoginRequest {
  email: string
  password: string
  turnstile_token?: string | null
}

export interface LoginResponse {
  access_token: string
  refresh_token?: string
  user: User
  requires_otp?: boolean
  system_lock?: import('../api/systemLock').SystemLockStatus | null
}

export interface OTPVerifyRequest {
  email: string
  otp: string
}

export interface OTPVerifyResponse {
  access_token: string
  refresh_token?: string
  user: User
}
