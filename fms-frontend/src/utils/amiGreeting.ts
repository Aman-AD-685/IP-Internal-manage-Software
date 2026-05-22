/** Ami mascot: one greeting per login session (cleared on logout). */
const STORAGE_KEY = 'fms_ami_greeting_shown'

export function wasAmiGreetingShown(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function markAmiGreetingShown(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* private mode */
  }
}

export function clearAmiGreetingSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
