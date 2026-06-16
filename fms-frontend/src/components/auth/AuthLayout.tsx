import { ReactNode } from 'react'
import './auth.css'

interface AuthLayoutProps {
  children: ReactNode
  variant?: 'register' | 'login'
}

export const AuthLayout = ({ children }: AuthLayoutProps) => {
  return (
    <div className="auth-page">
      <div className="auth-page-bg" aria-hidden="true">
        <div className="auth-page-bg__mesh" />
        <div className="auth-page-bg__grid" />
        <div className="auth-page-bg__stripes" />
        <div className="auth-page-bg__glow auth-page-bg__glow--tl" />
        <div className="auth-page-bg__glow auth-page-bg__glow--br" />
        <div className="auth-page-bg__frame auth-page-bg__frame--tl" />
        <div className="auth-page-bg__frame auth-page-bg__frame--tr" />
        <div className="auth-page-bg__frame auth-page-bg__frame--bl" />
        <div className="auth-page-bg__frame auth-page-bg__frame--br" />
        <div className="auth-page-bg__dots" />
        <div className="auth-page-bg__accent-bar" />
      </div>
      <img src="/logo.png" alt="Industryprime" className="auth-page-logo" />
      <div className="auth-page-content">{children}</div>
    </div>
  )
}
