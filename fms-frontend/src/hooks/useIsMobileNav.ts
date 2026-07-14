import { useSyncExternalStore } from 'react'

const QUERY = '(max-width: 767px)'

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches
}

function getServerSnapshot() {
  return false
}

/** Matches `responsive.css` mobile breakpoint for nav shell. */
export function useIsMobileNav() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
