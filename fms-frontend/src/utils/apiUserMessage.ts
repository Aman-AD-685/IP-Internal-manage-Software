/** Strip internal setup hints from API errors before showing end users. */
function looksTechnical(message: string): boolean {
  const low = message.toLowerCase()
  return (
    low.includes('supabase') ||
    low.includes('.sql') ||
    low.includes('uvicorn') ||
    low.includes('npm run') ||
    low.includes('database/') ||
    low.includes('docs/') ||
    low.includes('pgrst') ||
    low.includes('postgrest') ||
    low.includes('backend/') ||
    low.includes('frontend/') ||
    /run .+ in .+ editor/.test(low)
  )
}

/**
 * User-safe message for API failures (no database / dev-server / file-path hints).
 */
export function apiUserMessage(
  error: unknown,
  fallback: string,
  options?: { status503?: string; status429?: string },
): string {
  const ax = error as { response?: { status?: number; data?: { detail?: string } }; message?: string }
  const status = ax.response?.status
  const detail =
    typeof ax.response?.data?.detail === 'string' ? ax.response.data.detail.trim() : ''

  if (status === 503) {
    return options?.status503 ?? 'This action is temporarily unavailable. Please try again shortly or contact your administrator.'
  }
  if (status === 429) {
    return options?.status429 ?? 'Too many requests. Please wait a moment and try again.'
  }
  if (detail && !looksTechnical(detail)) {
    return detail
  }
  return fallback
}
