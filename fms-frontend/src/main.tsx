import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  bootstrapAuthBrowserSession,
  installAuthBrowserSessionHandlers,
} from './utils/authBrowserSession'
import App from './App'
import { redirectRecoveryToResetPage, bootstrapRecoveryFromUrl } from './utils/recoveryAuth'

installAuthBrowserSessionHandlers()
bootstrapAuthBrowserSession()
bootstrapRecoveryFromUrl()
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <QueryDevtools />
    </QueryClientProvider>
  </React.StrictMode>
)
