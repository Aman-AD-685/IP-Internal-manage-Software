import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  bootstrapAuthBrowserSession,
  installAuthBrowserSessionHandlers,
} from './utils/authBrowserSession'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { redirectRecoveryToResetPage, bootstrapRecoveryFromUrl } from './utils/recoveryAuth'

import 'antd/dist/reset.css'
import './styles/print.css'
import './styles/responsive.css'
import './styles/app-pages.css'
import './styles/industrial-ui.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 120_000,
      gcTime: 600_000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: 1,
    },
  },
})

let QueryDevtools = () => null

if (import.meta.env.DEV) {
  const ReactQueryDevtoolsPanel = React.lazy(async () => {
    const mod = await import('@tanstack/react-query-devtools')
    return { default: mod.ReactQueryDevtools }
  })

  QueryDevtools = () => (
    <React.Suspense fallback={null}>
      <ReactQueryDevtoolsPanel initialIsOpen={false} />
    </React.Suspense>
  )
}

async function start() {
  installAuthBrowserSessionHandlers()
  await bootstrapAuthBrowserSession()
  bootstrapRecoveryFromUrl()

  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      window.setInterval(() => {
        void registration.update()
      }, 60 * 60 * 1000)
    },
  })

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
        <QueryDevtools />
      </QueryClientProvider>
    </React.StrictMode>
  )
}

void start()
