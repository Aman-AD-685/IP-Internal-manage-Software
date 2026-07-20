import { useEffect, useRef, useCallback } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string
          callback: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: () => void
          theme?: 'light' | 'dark' | 'auto'
        }
      ) => string
      reset: (widgetId?: string) => void
      remove: (widgetId?: string) => void
    }
    onTurnstileLoad?: () => void
  }
}

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim()

export function isTurnstileEnabled(): boolean {
  return SITE_KEY.length > 0
}

type Props = {
  onToken: (token: string | null) => void
  className?: string
}

/** Cloudflare Turnstile — no-op when VITE_TURNSTILE_SITE_KEY is unset (local dev). */
export function TurnstileWidget({ onToken, className }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken

  const renderWidget = useCallback(() => {
    if (!SITE_KEY || !hostRef.current || !window.turnstile) return
    if (widgetIdRef.current) {
      try {
        window.turnstile.remove(widgetIdRef.current)
      } catch {
        /* ignore */
      }
      widgetIdRef.current = null
    }
    hostRef.current.innerHTML = ''
    widgetIdRef.current = window.turnstile.render(hostRef.current, {
      sitekey: SITE_KEY,
      callback: (token) => onTokenRef.current(token),
      'expired-callback': () => onTokenRef.current(null),
      'error-callback': () => onTokenRef.current(null),
      theme: 'auto',
    })
  }, [])

  useEffect(() => {
    if (!SITE_KEY) {
      onTokenRef.current(null)
      return
    }

    const prev = window.onTurnstileLoad
    window.onTurnstileLoad = () => {
      prev?.()
      renderWidget()
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-fms-turnstile]')
    if (window.turnstile) {
      renderWidget()
    } else if (!existing) {
      const s = document.createElement('script')
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit'
      s.async = true
      s.dataset.fmsTurnstile = '1'
      document.head.appendChild(s)
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          /* ignore */
        }
        widgetIdRef.current = null
      }
    }
  }, [renderWidget])

  if (!SITE_KEY) return null
  return <div ref={hostRef} className={className} style={{ margin: '12px 0' }} />
}
