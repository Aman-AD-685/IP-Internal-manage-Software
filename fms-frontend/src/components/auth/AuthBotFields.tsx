import { useRef, type CSSProperties } from 'react'
import { Form, Input } from 'antd'

const honeypotWrapStyle: CSSProperties = {
  position: 'absolute',
  left: -10000,
  top: 'auto',
  width: 1,
  height: 1,
  overflow: 'hidden',
  opacity: 0,
  pointerEvents: 'none',
}

/** Hidden honeypot — bots often fill "website"; humans never see it. */
export function AuthHoneypotField() {
  return (
    <div className="auth-honeypot" style={honeypotWrapStyle} aria-hidden="true">
      <Form.Item name="website" initialValue="">
        <Input
          tabIndex={-1}
          autoComplete="off"
          name="website"
          placeholder="Website"
        />
      </Form.Item>
    </div>
  )
}

/**
 * Capture when the form became active (ms since epoch) for server timing check.
 * Pass `active` (e.g. modal `open`) so long-lived layouts reset the timer each open —
 * otherwise a morning layout mount makes afternoon submits look >2h old and get blocked.
 */
export function useAuthFormOpenedMs(active = true): number {
  const opened = useRef(Date.now())
  const wasActive = useRef(active)
  if (active && !wasActive.current) {
    opened.current = Date.now()
  }
  wasActive.current = active
  return opened.current
}

export function withAuthBotFields<T extends Record<string, unknown>>(
  values: T,
  formOpenedMs: number,
): T & { website?: string; form_opened_ms: number } {
  const website = typeof values.website === 'string' ? values.website : ''
  const { website: _w, ...rest } = values as T & { website?: string }
  return {
    ...(rest as T),
    website: website || '',
    form_opened_ms: formOpenedMs,
  }
}
