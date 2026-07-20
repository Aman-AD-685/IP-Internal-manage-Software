import axios, { AxiosError, InternalAxiosRequestConfig } from "axios"
import { readAuthSessionGeneration, storage } from "../utils/storage"
import { ROUTES } from "../utils/constants"
import { buildLoginUrl } from "../utils/authRedirect"
import { isPublicPasswordResetPath } from "../utils/recoveryAuth"
import {
  DEFAULT_LOCAL_BACKEND_ORIGIN,
  getViteApiBaseFromEnv,
  isHttpLoopbackApiUrl,
  resolveDefaultLocalBackendUrl,
} from "../utils/localBackend"

export { getLocalUvicornStartCommand } from "../utils/localBackend"

/** Default production backend (Render). Must match your deployed FastAPI URL. */
export const PRODUCTION_API_FALLBACK = "https://ip-internal-manage-software.onrender.com"

declare global {
  interface Window {
    /** Set in index.html to override API base without a new Vite env build */
    __FMS_API_BASE_URL__?: string
  }
}

/**
 * Resolve API base URL.
 * Fixes: Vercel env often mistakenly set to the frontend URL (industryprime.vercel.app)
 * → POST /onboarding/... hits the static site → 404 "Not Found".
 *
 * Local dev: default = same-origin /api + Vite proxy → avoids ERR_NETWORK (browser → 127.0.0.1) on Windows.
 * Set VITE_DEV_SAME_ORIGIN_PROXY=0 for direct calls to VITE_API_BASE_URL instead.
 */
function resolveApiBase(): string {
  const _local = DEFAULT_LOCAL_BACKEND_ORIGIN
  const runtime =
    typeof window !== "undefined" && window.__FMS_API_BASE_URL__?.trim()
      ? window.__FMS_API_BASE_URL__.trim()
      : ""
  const fromVite =
    (import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || "").trim()
  const devSameOriginProxy = import.meta.env.VITE_DEV_SAME_ORIGIN_PROXY !== "0"

  // Explicit runtime override (index.html) — keep full URL
  if (runtime) {
    let raw = runtime.replace(/\/+$/, "")
    if (typeof window !== "undefined" && import.meta.env.PROD) {
      try {
        const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`)
        const path = (u.pathname || "/").replace(/\/+$/, "") || "/"
        const sameOriginAsPage = u.origin === window.location.origin
        if (sameOriginAsPage && path === "/") {
          console.warn(
            "[FMS] API base is the same as this website — using Render backend instead:",
            PRODUCTION_API_FALLBACK
          )
          return PRODUCTION_API_FALLBACK.replace(/\/+$/, "")
        }
      } catch {
        /* ignore */
      }
    }
    return raw
  }

  // Vite dev + browser: default `/api` + proxy (see vite.config). Direct URL if VITE_DEV_SAME_ORIGIN_PROXY=0.
  if (import.meta.env.DEV && typeof window !== "undefined") {
    const v = fromVite.replace(/\/+$/, "")
    if (devSameOriginProxy) {
      if (!v || isHttpLoopbackApiUrl(v)) {
        return "/api"
      }
    } else {
      if (isHttpLoopbackApiUrl(v)) {
        return v
      }
      if (!v) {
        return _local
      }
    }
  }

  let raw =
    fromVite ||
    (import.meta.env.DEV ? _local : PRODUCTION_API_FALLBACK)
  raw = raw.replace(/\/+$/, "")

  if (typeof window !== "undefined" && import.meta.env.PROD) {
    try {
      const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`)
      const path = (u.pathname || "/").replace(/\/+$/, "") || "/"
      const sameOriginAsPage = u.origin === window.location.origin
      if (sameOriginAsPage && path === "/") {
        console.warn(
          "[FMS] API base is the same as this website — using Render backend instead:",
          PRODUCTION_API_FALLBACK
        )
        return PRODUCTION_API_FALLBACK.replace(/\/+$/, "")
      }
    } catch {
      /* ignore */
    }
  }

  return raw
}

/**
 * Absolute URL for external schedulers (cron, CI, PaaS jobs) to POST the feature-approval reminder run.
 * Uses real backend host from VITE_API_BASE_URL / runtime override — never the Vite dev-server origin (e.g. :3001).
 */
function resolveBackendCronUrl(path: string): string {
  const runtime =
    typeof window !== "undefined" && window.__FMS_API_BASE_URL__?.trim()
      ? window.__FMS_API_BASE_URL__.trim().replace(/\/+$/, "")
      : ""
  if (runtime.startsWith("http")) {
    return `${runtime}${path}`
  }
  const vite = getViteApiBaseFromEnv()
  if (vite.startsWith("http")) {
    return `${vite.replace(/\/+$/, "")}${path}`
  }
  if (import.meta.env.PROD) {
    return `${PRODUCTION_API_FALLBACK.replace(/\/+$/, "")}${path}`
  }
  return `${resolveDefaultLocalBackendUrl().replace(/\/+$/, "")}${path}`
}

export function resolveFeatureApprovalCronRunUrl(): string {
  return resolveBackendCronUrl("/feature-approval-reminders/run")
}

/** Single cron-job.org URL — runs all email modules (feature, checklist, delegation, escalation). */
export function resolveCronRunAllEmailsUrl(): string {
  return resolveBackendCronUrl("/cron/run-all-emails")
}

/** @deprecated Use resolveCronRunAllEmailsUrl — /scheduler/tick still works as alias */
export function resolveSchedulerTickUrl(): string {
  return resolveCronRunAllEmailsUrl()
}

export function resolveChecklistCronUrl(): string {
  return resolveBackendCronUrl("/checklist/send-daily-reminders")
}

export function resolveDelegationCronUrl(): string {
  return resolveBackendCronUrl("/delegation/send-daily-reminders")
}

export function resolveEscalationPendingCronUrl(): string {
  return resolveBackendCronUrl("/escalation/send-pending-mails")
}

export function resolveEscalationCriticalCronUrl(): string {
  return resolveBackendCronUrl("/escalation/send-critical-mails")
}

export function resolveEscalationStageCronUrl(): string {
  return resolveBackendCronUrl("/escalation/send-stage-mails")
}

export const API_BASE_URL = resolveApiBase()

if (import.meta.env.PROD && (API_BASE_URL.includes("127.0.0.1") || API_BASE_URL.includes("localhost"))) {
  console.error(
    "[FMS] Production build is using localhost as API. Set VITE_API_BASE_URL on Vercel, window.__FMS_API_BASE_URL__, or fix .env.production."
  )
}

export const isLocalBackend =
  API_BASE_URL === "/api" ||
  API_BASE_URL.includes("127.0.0.1") ||
  API_BASE_URL.includes("localhost")

console.log("🔗 API Base URL:", API_BASE_URL)

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30000,
})

function isSupportLookupApiPath(pathOnly: string): boolean {
  return (
    pathOnly === '/companies' ||
    pathOnly.startsWith('/companies/') ||
    pathOnly === '/pages' ||
    pathOnly === '/divisions'
  )
}

type TimedRequestConfig = InternalAxiosRequestConfig & {
  metadata?: { start: number }
}

const logApiDuration = (
  cfg: InternalAxiosRequestConfig | undefined,
  status: number | string
) => {
  if (!import.meta.env.DEV || !cfg) return
  const timed = cfg as TimedRequestConfig
  const start = timed.metadata?.start
  const durationMs =
    typeof start === "number" ? Math.round((performance.now() - start) * 100) / 100 : -1
  const method = (cfg.method || "get").toUpperCase()
  const url = cfg.url || ""
  console.debug("[api]", method, url, status, durationMs >= 0 ? durationMs : "n/a")
}

function requestHasAuthorizationHeader(config: InternalAxiosRequestConfig): boolean {
  const headers = config.headers
  if (!headers) return false
  if (typeof (headers as { get?: (k: string) => unknown }).get === "function") {
    return !!(headers as { get: (k: string) => unknown }).get("Authorization")
  }
  return !!(headers as Record<string, unknown>).Authorization
}

function shouldSkipLoginRedirect(): boolean {
  if (typeof window === "undefined") return false
  const path = window.location.pathname
  return (
    path.includes("/login") ||
    path.includes("/register") ||
    isPublicPasswordResetPath(path)
  )
}

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const timed = config as TimedRequestConfig
    timed.metadata = { start: performance.now() }
    const token = storage.getToken()
    // Do not overwrite explicit Authorization (e.g. Supabase recovery JWT)
    if (token && config.headers && !requestHasAuthorizationHeader(config)) {
      config.headers.Authorization = `Bearer ${token}`
    }
    // Browser client binding — backend may require X-FMS-Client in production
    if (config.headers) {
      config.headers["X-FMS-Client"] = "web"
    }
    if (config.data instanceof FormData && config.headers) {
      delete config.headers["Content-Type"]
    }
    return config
  },
  (error) => Promise.reject(error)
)

let isRefreshing = false
let refreshSubscribers: Array<(token: string) => void> = []

const onRefreshed = (token: string) => {
  refreshSubscribers.forEach((cb) => cb(token))
  refreshSubscribers = []
}

const addRefreshSubscriber = (cb: (token: string) => void) => {
  refreshSubscribers.push(cb)
}

apiClient.interceptors.response.use(
  (response) => {
    logApiDuration(response.config, response.status)
    return response
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean
      _api404Retry?: boolean
    }

    // Render / some hosts only forward /api/* to FastAPI → root /onboarding/* returns 404
    const apiBaseNorm = API_BASE_URL.replace(/\/+$/, "")
    if (
      error.response?.status === 404 &&
      originalRequest &&
      !originalRequest._api404Retry &&
      apiBaseNorm !== "/api"
    ) {
      const raw = originalRequest.url || ""
      const pathOnly = (raw.split("?")[0] || "").replace(/^\/+/, "/")
      const normalized = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`
      const qs = raw.includes("?") ? raw.slice(raw.indexOf("?")) : ""
      if (
        !normalized.startsWith("/api") &&
        (normalized.startsWith("/onboarding/") || isSupportLookupApiPath(normalized))
      ) {
        originalRequest._api404Retry = true
        originalRequest.url = `/api${normalized}${qs}`
        return apiClient.request(originalRequest)
      }
    }

    if (error.response?.status === 423) {
      const body = error.response?.data as {
        message?: string
        reason?: string
        error?: string
      } | undefined
      if (typeof window !== 'undefined') {
        const lockStatus = {
          is_locked: true,
          reason: (typeof body?.reason === 'string' && body.reason.trim()) || null,
          locked_by: null,
          locked_by_name: null,
          locked_at: null,
          unlocked_at: null,
          updated_at: null,
        }
        window.dispatchEvent(new CustomEvent('fms:system-lock-changed', { detail: lockStatus }))
      }
      return Promise.reject(error)
    }

    if (error.response?.status === 429) {
      const body = error.response?.data as { detail?: string; retry_after_sec?: number } | undefined
      const wait = body?.retry_after_sec
      const hint =
        typeof body?.detail === "string"
          ? body.detail
          : "Too many requests. Please wait a moment and try again."
      const err = new Error(wait ? `${hint} (retry in ~${wait}s)` : hint)
      err.name = "RateLimitError"
      return Promise.reject(err)
    }

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      const reqUrl = originalRequest.url || ""
      // Wrong password / public auth — never treat as expired session or run refresh (avoids delays & bogus "timeout" UX)
      const isPublicAuthEndpoint =
        reqUrl.includes("/auth/login") ||
        reqUrl.includes("/auth/register") ||
        reqUrl.includes("/auth/verify-otp") ||
        reqUrl.includes("/auth/forgot-password") ||
        reqUrl.includes("/auth/recovery-password") ||
        reqUrl.includes("/approval/execute-by-token") ||
        reqUrl.includes("/approval/email-action")
      if (isPublicAuthEndpoint) {
        return Promise.reject(error)
      }

      const isRefreshRequest = originalRequest.url?.includes("/auth/refresh")
      if (isRefreshRequest) {
        storage.clear()
        if (!shouldSkipLoginRedirect()) {
          window.location.href = buildLoginUrl()
        }
        return Promise.reject(error)
      }

      const refreshToken = storage.getRefreshToken()
      if (refreshToken) {
        const refreshGeneration = readAuthSessionGeneration()
        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            addRefreshSubscriber((token: string) => {
              if (!token || refreshGeneration !== readAuthSessionGeneration()) {
                reject(error)
                return
              }
              if (originalRequest.headers) originalRequest.headers.Authorization = `Bearer ${token}`
              resolve(apiClient(originalRequest))
            })
          })
        }
        isRefreshing = true
        let result: { access_token?: string; refresh_token?: string } | null = null
        try {
          const res = await axios.post<{ access_token: string; refresh_token?: string }>(
            `${API_BASE_URL}/auth/refresh`,
            { refresh_token: refreshToken },
            { headers: { "Content-Type": "application/json", "X-FMS-Client": "web" }, timeout: 20000 }
          )
          result = res.data
        } catch {
          // One more try after brief wait (sleep/network blip)
          try {
            await new Promise((r) => setTimeout(r, 1000))
            const res2 = await axios.post<{ access_token: string; refresh_token?: string }>(
              `${API_BASE_URL}/auth/refresh`,
              { refresh_token: refreshToken },
              { headers: { "Content-Type": "application/json", "X-FMS-Client": "web" }, timeout: 20000 }
            )
            result = res2.data
          } catch {
            result = null
          }
        }
        isRefreshing = false
        if (result?.access_token && refreshGeneration === readAuthSessionGeneration() && storage.getRefreshToken()) {
          storage.setToken(result.access_token)
          if (result.refresh_token) storage.setRefreshToken(result.refresh_token)
          onRefreshed(result.access_token)
          if (originalRequest.headers) originalRequest.headers.Authorization = `Bearer ${result.access_token}`
          originalRequest._retry = true
          return apiClient(originalRequest)
        }
        onRefreshed("")
      }

      storage.clear()
      if (!shouldSkipLoginRedirect()) {
        window.location.href = buildLoginUrl()
      }
    } else if (error.request) {
      console.error("❌ Network error: backend not reachable at", API_BASE_URL)
    }

    logApiDuration(error.config as InternalAxiosRequestConfig | undefined, error.response?.status ?? "ERR")
    return Promise.reject(error)
  }
)

export default apiClient
