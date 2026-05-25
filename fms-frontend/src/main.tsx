import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import {
  bootstrapAuthBrowserSession,
  installAuthBrowserSessionHandlers,
} from './utils/authBrowserSession'
import App from './App'

installAuthBrowserSessionHandlers()
bootstrapAuthBrowserSession()
import 'antd/dist/reset.css'
import './styles/print.css'
import './styles/responsive.css'
import './styles/app-pages.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 300_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>
)
