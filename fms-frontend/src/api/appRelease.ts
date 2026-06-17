import apiClient, { API_BASE_URL } from './axios'
import { getClientReleaseKey, releaseKeysMatch } from '../utils/releaseKey'

export interface AppReleaseBroadcast {
  release_key: string
  title: string
  message: string
  is_active: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function releaseUrl(): string {
  const base = API_BASE_URL.replace(/\/+$/, '')
  return `${base}/app/release`
}

function frontendReleaseUrl(): string {
  if (typeof window === 'undefined') return '/release.json'
  return `${window.location.origin}/release.json`
}

async function fetchReleaseJson(url: string): Promise<AppReleaseBroadcast | null> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
      return null
    }
    const body = (await res.json()) as AppReleaseBroadcast | { data?: AppReleaseBroadcast }
    if (body && typeof body === 'object' && 'release_key' in body) {
      return body as AppReleaseBroadcast
    }
    return (body as { data?: AppReleaseBroadcast })?.data ?? null
  } catch {
    return null
  }
}

/** First source that differs from the loaded bundle (production deploy detection). */
export function findReleaseNeedingRefresh(
  sources: Array<AppReleaseBroadcast | null | undefined>,
  clientKey = getClientReleaseKey(),
): AppReleaseBroadcast | null {
  for (const source of sources) {
    if (!source?.is_active || !source.release_key?.trim()) continue
    if (releaseKeysMatch(clientKey, source.release_key)) continue
    return source
  }
  return null
}

export const appReleaseApi = {
  /** Backend / Supabase release row (optional manual bump). */
  get: async (): Promise<AppReleaseBroadcast | null> => {
    const attempts = 3
    for (let i = 0; i < attempts; i += 1) {
      const data = await fetchReleaseJson(releaseUrl())
      if (data) return data
      if (i < attempts - 1) await sleep(400 * (i + 1))
    }
    return null
  },

  /** Live Vercel deploy manifest — auto-updates every frontend push (no SQL step). */
  getFrontend: async (): Promise<AppReleaseBroadcast | null> => {
    const attempts = 2
    for (let i = 0; i < attempts; i += 1) {
      const data = await fetchReleaseJson(frontendReleaseUrl())
      if (data) return data
      if (i < attempts - 1) await sleep(300)
    }
    return null
  },

  /** Backend + frontend manifest — show refresh bar when either is newer than loaded JS. */
  getCurrent: async (): Promise<AppReleaseBroadcast | null> => {
    const [backend, frontend] = await Promise.all([appReleaseApi.get(), appReleaseApi.getFrontend()])
    return findReleaseNeedingRefresh([frontend, backend])
  },

  /** Master Admin: push release state to all WebSocket clients (after bump_app_release in Supabase). */
  notifyLive: async (): Promise<AppReleaseBroadcast | null> => {
    try {
      const res = await apiClient.post<{ success?: boolean; data?: AppReleaseBroadcast }>(
        '/app/release/notify',
      )
      return res.data?.data ?? null
    } catch {
      return null
    }
  },
}
