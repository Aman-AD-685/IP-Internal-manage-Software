/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_API_URL: string
  readonly VITE_APP_NAME: string
  /** Default: proxy on. Set to "0" for direct browser → VITE_API_BASE_URL in dev */
  readonly VITE_DEV_SAME_ORIGIN_PROXY: string
  /** Embedded at build time — must match Supabase app_release_broadcast.release_key after deploy */
  readonly VITE_APP_RELEASE_KEY: string
  /** Cloudflare Turnstile site key (public). Leave empty to skip widget in local dev. */
  readonly VITE_TURNSTILE_SITE_KEY: string
  /** Set to "0" to hide Sign Up when public registration is disabled */
  readonly VITE_ALLOW_PUBLIC_REGISTER: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
