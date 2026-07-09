import { apiClient } from './axios'
import { API_ENDPOINTS } from '../utils/constants'
import {
  API_CACHE_TTL_MS,
  sessionApiCacheClearLogicalPrefix,
  sessionApiCacheGet,
  sessionApiCacheSet,
} from '../utils/sessionApiCache'

export interface PaymentStatusRecord {
  id: string
  timestamp: string
  reference_no: string
  company_name: string
  payment_status: 'Done' | 'Not Done'
  payment_received_date: string | null
  poc_name: string | null
  poc_contact: string | null
  accounts_remarks: string | null
  status?: string
  fi_do?: string
  created_at: string
}

export const onboardingApi = {
  listPaymentStatus: async () => {
    const key = 'onboarding:payment-status:list:v2'
    const cached = sessionApiCacheGet<{ items: PaymentStatusRecord[]; total?: number }>(key)
    if (cached?.items) return cached
    const r = await apiClient.get<{ data?: PaymentStatusRecord[]; items?: PaymentStatusRecord[]; total?: number }>(
      API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.LIST,
      { params: { page: 1, page_size: 200 } },
    )
    const body = r.data ?? {}
    const rows = body.data ?? body.items ?? []
    const payload = { items: rows, total: body.total ?? rows.length }
    sessionApiCacheSet(key, payload, API_CACHE_TTL_MS.onboardingPaymentStatusList)
    return payload
  },

  createPaymentStatus: async (payload: {
    company_name: string
    payment_status: 'Done' | 'Not Done'
    payment_received_date?: string | null
    poc_name?: string | null
    poc_contact?: string | null
    accounts_remarks?: string | null
  }) => {
    const r = await apiClient.post<PaymentStatusRecord>(API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.CREATE, payload)
    sessionApiCacheClearLogicalPrefix('onboarding:payment-status:list')
    sessionApiCacheClearLogicalPrefix('onboarding:payment-status:list:v2')
    return r.data
  },

  getPreOnboarding: (paymentStatusId: string) =>
    apiClient
      .get<{ data: Record<string, unknown>; submitted_at: string | null; editable_until: string | null; editable_48h: boolean }>(
        API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.PRE_ONBOARDING(paymentStatusId)
      )
      .then((r) => r.data),

  savePreOnboarding: (paymentStatusId: string, data: Record<string, unknown>) =>
    apiClient
      .post<{ data: Record<string, unknown>; submitted_at: string | null; editable_until: string | null; editable_48h: boolean }>(
        API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.PRE_ONBOARDING(paymentStatusId),
        { data }
      )
      .then((r) => r.data),

  getPreOnboardingChecklist: (paymentStatusId: string) =>
    apiClient
      .get<{ data: Record<string, unknown>; submitted_at: string | null; editable_until: string | null; editable_48h: boolean }>(
        API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.PRE_ONBOARDING_CHECKLIST(paymentStatusId)
      )
      .then((r) => r.data),

  savePreOnboardingChecklist: (paymentStatusId: string, data: Record<string, unknown>) =>
    apiClient
      .post<{ data: Record<string, unknown>; submitted_at: string | null; editable_until: string | null; editable_48h: boolean }>(
        API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.PRE_ONBOARDING_CHECKLIST(paymentStatusId),
        { data }
      )
      .then((r) => r.data),

  getPocChecklist: (paymentStatusId: string) =>
    apiClient
      .get<{ data: Record<string, unknown>; submitted_at: string | null; editable_until: string | null; editable_48h: boolean }>(
        API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.POC_CHECKLIST(paymentStatusId)
      )
      .then((r) => r.data),

  savePocChecklist: (paymentStatusId: string, data: Record<string, unknown>) =>
    apiClient
      .post<{ data: Record<string, unknown>; submitted_at: string | null; editable_until: string | null; editable_48h: boolean }>(
        API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.POC_CHECKLIST(paymentStatusId),
        { data }
      )
      .then((r) => r.data),

  getPocDetails: (paymentStatusId: string) =>
    apiClient
      .get<{ data: Record<string, unknown> }>(API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.POC_DETAILS(paymentStatusId))
      .then((r) => r.data),

  savePocDetails: (paymentStatusId: string, data: Record<string, unknown>) =>
    apiClient
      .post<{ data: Record<string, unknown> }>(API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.POC_DETAILS(paymentStatusId), { data })
      .then((r) => r.data),

  getDetailsCollectedChecklist: (paymentStatusId: string) =>
    apiClient
      .get<{ data: Record<string, unknown>; submitted_at: string | null; editable_until: string | null; editable_48h: boolean }>(
        API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.DETAILS_COLLECTED_CHECKLIST(paymentStatusId)
      )
      .then((r) => r.data),

  saveDetailsCollectedChecklist: (paymentStatusId: string, data: Record<string, unknown>) =>
    apiClient
      .post<{ data: Record<string, unknown>; submitted_at: string | null; editable_until: string | null; editable_48h: boolean }>(
        API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.DETAILS_COLLECTED_CHECKLIST(paymentStatusId),
        { data }
      )
      .then((r) => r.data),

  getItemCleaning: (paymentStatusId: string) =>
    apiClient
      .get<{ data: Record<string, unknown> }>(API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.ITEM_CLEANING(paymentStatusId))
      .then((r) => r.data),

  saveItemCleaning: (paymentStatusId: string, data: Record<string, unknown>) =>
    apiClient
      .post<{ data: Record<string, unknown> }>(API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.ITEM_CLEANING(paymentStatusId), { data })
      .then((r) => r.data),

  getItemCleaningChecklist: (paymentStatusId: string) =>
    apiClient
      .get<{ data: Record<string, unknown>; submitted_at: string | null; editable_until: string | null; editable_48h: boolean }>(
        API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.ITEM_CLEANING_CHECKLIST(paymentStatusId)
      )
      .then((r) => r.data),

  saveItemCleaningChecklist: (paymentStatusId: string, data: Record<string, unknown>) =>
    apiClient
      .post<{ data: Record<string, unknown>; submitted_at: string | null; editable_until: string | null; editable_48h: boolean }>(
        API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.ITEM_CLEANING_CHECKLIST(paymentStatusId),
        { data }
      )
      .then((r) => r.data),

  getOrgMasterId: (paymentStatusId: string) =>
    apiClient
      .get<{ data: Record<string, unknown> }>(API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.ORG_MASTER_ID(paymentStatusId))
      .then((r) => r.data),

  saveOrgMasterId: (paymentStatusId: string, data: Record<string, unknown>) =>
    apiClient
      .post<{ data: Record<string, unknown> }>(API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.ORG_MASTER_ID(paymentStatusId), { data })
      .then((r) => r.data),

  getOrgMasterChecklist: (paymentStatusId: string) =>
    apiClient.get<{ data: Record<string, unknown>; submitted_at: string | null; editable_until: string | null; editable_48h: boolean }>(
      API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.ORG_MASTER_CHECKLIST(paymentStatusId)
    ).then((r) => r.data),
  saveOrgMasterChecklist: (paymentStatusId: string, data: Record<string, unknown>) =>
    apiClient.post<{ data: Record<string, unknown>; submitted_at: string | null; editable_until: string | null; editable_48h: boolean }>(
      API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.ORG_MASTER_CHECKLIST(paymentStatusId),
      { data }
    ).then((r) => r.data),

  getSetupChecklist: (paymentStatusId: string) =>
    apiClient.get<{ data: Record<string, unknown>; submitted_at: string | null; editable_until: string | null; editable_48h: boolean }>(
      API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.SETUP_CHECKLIST(paymentStatusId)
    ).then((r) => r.data),
  saveSetupChecklist: (paymentStatusId: string, data: Record<string, unknown>) =>
    apiClient.post<{ data: Record<string, unknown>; submitted_at: string | null; editable_until: string | null; editable_48h: boolean }>(
      API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.SETUP_CHECKLIST(paymentStatusId),
      { data }
    ).then((r) => r.data),

  getItemStockChecklist: (paymentStatusId: string) =>
    apiClient.get<{ data: Record<string, unknown>; submitted_at: string | null; editable_until: string | null; editable_48h: boolean }>(
      API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.ITEM_STOCK_CHECKLIST(paymentStatusId)
    ).then((r) => r.data),
  saveItemStockChecklist: (paymentStatusId: string, data: Record<string, unknown>) =>
    apiClient.post<{ data: Record<string, unknown>; submitted_at: string | null; editable_until: string | null; editable_48h: boolean }>(
      API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.ITEM_STOCK_CHECKLIST(paymentStatusId),
      { data }
    ).then((r) => r.data),

  getFinalSetup: (paymentStatusId: string) =>
    apiClient.get<{ data: Record<string, unknown>; submitted_at: string | null; editable_until: string | null; editable_48h: boolean }>(
      API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.FINAL_SETUP(paymentStatusId)
    ).then((r) => r.data),
  saveFinalSetup: (paymentStatusId: string, data: Record<string, unknown>) =>
    apiClient.post<{ data: Record<string, unknown>; submitted_at: string | null; editable_until: string | null; editable_48h: boolean }>(
      API_ENDPOINTS.ONBOARDING_PAYMENT_STATUS.FINAL_SETUP(paymentStatusId),
      { data }
    ).then((r) => {
      if (String(data.final_status ?? '').trim() === 'Done') {
        sessionApiCacheClearLogicalPrefix('training:clients:list')
      }
      return r.data
    }),
}
