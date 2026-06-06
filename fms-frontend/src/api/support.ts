import { apiClient } from './axios'
import {
  API_CACHE_TTL_MS,
  sessionApiCacheGet,
  sessionApiCacheRemove,
  sessionApiCacheSet,
  supportDivisionsLogicalKey,
} from '../utils/sessionApiCache'

export interface Company {
  id: string
  name: string
}

export interface Page {
  id: string
  name: string
}

export interface Division {
  id: string
  name: string
  company_id?: string
}

/** Backend may return a bare array (legacy) or a paginated envelope { data, total, page, page_size }. */
function unwrapListResponse<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[]
  if (body && typeof body === 'object') {
    const o = body as { data?: unknown; items?: unknown }
    if (Array.isArray(o.data)) return o.data as T[]
    if (Array.isArray(o.items)) return o.items as T[]
  }
  return []
}

function listTotal(body: unknown): number | undefined {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const t = (body as { total?: unknown }).total
    return typeof t === 'number' ? t : undefined
  }
  return undefined
}

/** Fetch all pages (page_size max 200 on backend) for lookup lists. */
async function fetchFullList<T>(path: string, extra: Record<string, string | number> = {}): Promise<T[]> {
  const pageSize = 200
  const all: T[] = []
  let page = 1
  for (;;) {
    const r = await apiClient.get(path, {
      params: { ...extra, page, page_size: pageSize },
    })
    const chunk = unwrapListResponse<T>(r.data)
    all.push(...chunk)
    const total = listTotal(r.data)
    if (chunk.length < pageSize || (total != null && all.length >= total)) break
    if (chunk.length === 0) break
    page += 1
    if (page > 100) break
  }
  return all
}

export const supportApi = {
  getCompanies: async (): Promise<Company[]> => {
    const key = 'support:companies:v2'
    const cached = sessionApiCacheGet<Company[]>(key)
    if (cached) return cached
    const rows = await fetchFullList<Company>('/companies')
    sessionApiCacheSet(key, rows, API_CACHE_TTL_MS.supportCompanies)
    return rows
  },
  getPages: async (): Promise<Page[]> => {
    const key = 'support:pages:v2'
    const cached = sessionApiCacheGet<Page[]>(key)
    if (cached) return cached
    const rows = await fetchFullList<Page>('/pages')
    sessionApiCacheSet(key, rows, API_CACHE_TTL_MS.supportPages)
    return rows
  },
  getDivisions: async (companyId?: string, opts?: { bustCache?: boolean }): Promise<Division[]> => {
    const key = supportDivisionsLogicalKey(companyId)
    if (opts?.bustCache) sessionApiCacheRemove(key)
    const cached = sessionApiCacheGet<Division[]>(key)
    if (cached) return cached
    const extra = companyId ? { company_id: companyId } : {}
    const rows = await fetchFullList<Division>('/divisions', extra)
    // Never cache empty lists — transient misses were sticking for 15 minutes in the picker.
    if (rows.length > 0) {
      sessionApiCacheSet(key, rows, API_CACHE_TTL_MS.supportDivisions)
    }
    return rows
  },
}
