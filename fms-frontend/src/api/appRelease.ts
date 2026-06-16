import apiClient, { API_BASE_URL } from './axios'

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

export const appReleaseApi = {
  get: async (): Promise<AppReleaseBroadcast | null> => {
    const attempts = 3
    for (let i = 0; i < attempts; i += 1) {
      try {
        const res = await fetch(releaseUrl(), {
          method: 'GET',
          cache: 'no-store',
          credentials: 'omit',
          headers: { Accept: 'application/json' },
        })
        if (!res.ok) throw new Error(`release ${res.status}`)
        const body = (await res.json()) as { success?: boolean; data?: AppReleaseBroadcast }
        return body?.data ?? null
      } catch {
        if (i < attempts - 1) await sleep(400 * (i + 1))
      }
    }
    return null
  },

  /** Master Admin: push release state to all WebSocket clients (after bump_app_release in Supabase). */
  notifyLive: async (): Promise<AppReleaseBroadcast | null> => {
    try {
      const res = await apiClient.post<{ success?: boolean; data?: AppReleaseBroadcast }>(
        '/app/release/notify'
      )
      return res.data?.data ?? null
    } catch {
      return null
    }
  },
}
