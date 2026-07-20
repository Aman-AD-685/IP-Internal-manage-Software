import { useRef } from 'react'
import { Form, Input } from 'antd'

/** Hidden honeypot — bots often fill "website"; humans never see it. */
export function AuthHoneypotField() {
  return (
    <div className="auth-honeypot" aria-hidden="true">
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
