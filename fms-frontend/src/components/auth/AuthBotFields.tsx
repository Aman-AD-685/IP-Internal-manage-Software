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

/** Capture when the auth form mounted (ms since epoch) for server timing check. */
export function useAuthFormOpenedMs(): number {
  const opened = useRef(Date.now())
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
