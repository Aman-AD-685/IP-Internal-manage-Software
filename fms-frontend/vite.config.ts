import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { visualizer } from 'rollup-plugin-visualizer'
import vitePluginImp from 'vite-plugin-imp'
import { VitePWA } from 'vite-plugin-pwa'

// Keep in sync with fms-frontend/src/utils/localBackend.ts (DEFAULT_LOCAL_BACKEND_ORIGIN)
const DEFAULT_BACKEND_TARGET = 'http://127.0.0.1:8020'

function resolveAppReleaseKey(mode: string, env: Record<string, string>): string {
  const explicit = (env.VITE_APP_RELEASE_KEY || '').trim()
  if (explicit) return explicit
  const vercelSha = (env.VERCEL_GIT_COMMIT_SHA || '').trim()
  if (vercelSha) return vercelSha.slice(0, 8)
  if (mode === 'development') return 'dev-local'
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim().slice(0, 8)
  } catch {
    return `build-${Date.now()}`
  }
}

/** Served at /release.json — logged-in clients poll this after each Vercel deploy. */
function releaseManifestPlugin(releaseKey: string): Plugin {
  const buildPayload = () =>
    JSON.stringify({
      release_key: releaseKey,
      title: 'New features are live',
      message: 'A new version is available. Refresh to load the latest features.',
      is_active: true,
    })

  return {
    name: 'fms-release-manifest',
    configureServer(server) {
      server.middlewares.use('/release.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(buildPayload())
      })
    },
    closeBundle() {
      const out = path.resolve(__dirname, 'dist/release.json')
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(out, buildPayload(), 'utf8')
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const appReleaseKey = resolveAppReleaseKey(mode, env)
  const target = (env.VITE_API_BASE_URL || env.VITE_API_URL || DEFAULT_BACKEND_TARGET).replace(
    /\/+$/,
    ''
  )

  // eslint-disable-next-line no-console
  console.log(
    `\n[FMS] API proxy target: ${target}\n` +
      `     Vite forwards /api/* → this URL. It MUST match uvicorn (same port as --port).\n` +
      `     If you see ECONNREFUSED, edit VITE_API_BASE_URL in fms-frontend/.env and restart npm run dev.\n`
  )

  return {
    define: {
      'import.meta.env.VITE_APP_RELEASE_KEY': JSON.stringify(appReleaseKey),
    },
    plugins: [
      react(),
      releaseManifestPlugin(appReleaseKey),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['logo.png', 'pwa-192.png', 'pwa-512.png', 'robots.txt'],
        manifest: {
          name: 'Industry Prime — IP Internal Management',
          short_name: 'Industry Prime',
          description:
            'IP Internal Management Software — tickets, checklist, delegation, KPIs, and onboarding.',
          theme_color: '#1677ff',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          scope: '/',
          lang: 'en',
          categories: ['business', 'productivity'],
          icons: [
            {
              src: 'pwa-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'pwa-512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'pwa-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          navigateFallback: '/index.html',
          // Keep release.json always fresh so deploy refresh prompts still work.
          navigateFallbackDenylist: [/^\/api/, /^\/release\.json$/],
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
          globIgnores: ['**/stats.html', '**/stats-*.html'],
          // antd chunk can exceed default 2 MiB; still fine for app-shell offline.
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          runtimeCaching: [
            {
              // Live API / auth / Supabase — never serve stale business data from SW.
              urlPattern: ({ url }) =>
                url.pathname.startsWith('/api') ||
                url.hostname.includes('supabase.co') ||
                url.hostname.includes('onrender.com') ||
                url.hostname.includes('industryprime.dpdns.org'),
              handler: 'NetworkOnly',
            },
            {
              urlPattern: ({ url }) => url.pathname === '/release.json',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'fms-release-json',
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 1, maxAgeSeconds: 60 },
              },
            },
            {
              urlPattern: ({ request }) => request.destination === 'image',
              handler: 'CacheFirst',
              options: {
                cacheName: 'fms-images',
                expiration: { maxEntries: 80, maxAgeSeconds: 30 * 24 * 60 * 60 },
              },
            },
          ],
        },
        devOptions: {
          // Keep SW off in vite dev — use `npm run build && npm run preview` to test install/offline.
          enabled: false,
        },
      }),
      vitePluginImp({
        libList: [
          {
            libName: 'antd',
            style: (name) => `antd/es/${name}/style`,
          },
        ],
      }),
    ],
    build: {
      target: 'es2020',
      sourcemap: false,
      rollupOptions: {
        plugins: [
          visualizer({ filename: 'dist/stats.html', gzipSize: true }),
        ],
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('recharts') || id.includes('react-simple-maps') || id.includes('d3-')) {
              return 'vendor-charts'
            }
            // Keep icons in the same chunk as antd (they reference each other; splitting causes circular chunks).
            if (id.includes('@ant-design/icons') || id.includes('node_modules/antd')) {
              return 'antd'
            }
            if (id.includes('node_modules/react-dom')) return 'react'
            if (id.includes('react-router')) return 'vendor-router'
            if (id.includes('node_modules/react/')) return 'react'
            if (id.includes('scheduler')) return 'react'
            if (id.includes('dayjs') || id.includes('axios')) return 'vendor-misc'
            return undefined
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 3001,
      open: true,
      // /api/* → FastAPI root paths (strip prefix). Target must match VITE_API_BASE_URL / uvicorn port.
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          ws: true,
          /** Slow /tickets enrichment (many lookups); avoid premature proxy read ECONNRESET on Windows. */
          timeout: 120_000,
          proxyTimeout: 120_000,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
