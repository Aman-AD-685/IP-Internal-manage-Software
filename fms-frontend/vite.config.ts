import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { visualizer } from 'rollup-plugin-visualizer'
import vitePluginImp from 'vite-plugin-imp'

// Keep in sync with fms-frontend/src/utils/localBackend.ts (DEFAULT_LOCAL_BACKEND_ORIGIN)
const DEFAULT_BACKEND_TARGET = 'http://127.0.0.1:8020'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
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
    plugins: [
      react(),
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
          /** Slow /tickets enrichment (many lookups); avoid premature proxy read ECONNRESET on Windows. */
          timeout: 120_000,
          proxyTimeout: 120_000,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
