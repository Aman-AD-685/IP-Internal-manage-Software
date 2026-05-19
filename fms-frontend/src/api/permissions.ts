import { apiClient } from './axios'
import { API_CACHE_TTL_MS, sessionApiCacheGet, sessionApiCacheSet } from '../utils/sessionApiCache'

export interface PermissionCatalogRow {
  key: string
  label: string
  group: 'app' | 'dashboard_kpi'
}

export interface DashboardKpiCatalogGroup {
  id: string
  label: string
  items: { key: string; label: string; group: string }[]
}

export interface SectionPermissionCatalog {
  section_keys: string[]
  rows: PermissionCatalogRow[]
  dashboard_kpi: {
    parent_key: string
    parent_label: string
    subsections: { key: string; label: string; group: string }[]
    groups: DashboardKpiCatalogGroup[]
  }
}

export const permissionsApi = {
  getSectionCatalog: async (): Promise<SectionPermissionCatalog> => {
    const key = 'permissions:section-catalog'
    const cached = sessionApiCacheGet<SectionPermissionCatalog>(key)
    if (cached) return cached
    const response = await apiClient.get<SectionPermissionCatalog>('/permissions/section-catalog')
    const data = response.data
    sessionApiCacheSet(key, data, API_CACHE_TTL_MS.usersRoles)
    return data
  },
}
