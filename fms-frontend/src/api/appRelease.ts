import apiClient from './axios'

export interface AppReleaseBroadcast {
  release_key: string
  title: string
  message: string
  is_active: boolean
}

export const appReleaseApi = {
  get: async (): Promise<AppReleaseBroadcast | null> => {
    try {
      const res = await apiClient.get<{ success: boolean; data: AppReleaseBroadcast }>('/app/release', {
        timeout: 8000,
      })
      return res.data?.data ?? null
    } catch {
      return null
    }
  },
}
