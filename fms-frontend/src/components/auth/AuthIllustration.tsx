const darkBlue = '#0b1220'
const lightBlue = '#60a5fa'

interface AuthIllustrationProps {
  variant: 'login' | 'register'
}

/** Left part: user icon + dashed circle + corner square - separately movable */
const LeftMovablePart = () => (
  <div className="auth-ill-left-movable" style={{ position: 'absolute', left: '5%', top: '10%', width: '45%', height: '85%', zIndex: 2 }}>
    <svg viewBox="0 0 200 260" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', objectFit: 'contain' }} fill="none">
      {/* Dashed circle - wraps user */}
      <circle cx="100" cy="130" r="95" stroke={lightBlue} strokeWidth="2" strokeDasharray="8 6" fill="none" opacity={0.5} />
      {/* Corner square - above user */}
      <rect x="45" y="20" width="55" height="55" rx="14" fill={`${lightBlue}18`} stroke={lightBlue} strokeWidth="1" opacity={0.7} />
      {/* Person - head, body */}
      <circle cx="70" cy="95" r="22" fill={darkBlue} />
      <ellipse cx="70" cy="85" rx="14" ry="6" fill={darkBlue} opacity={0.8} />
      <path d="M48 100 Q70 92 92 100 L92 165 Q70 178 48 165 Z" fill={darkBlue} opacity={0.9} />
    </svg>
  </div>
)

/** Illustration 1: Register - person + form with 3 inputs + gear, key, plant with padlock */
const RegisterIllustration = () => (
  <div className="auth-illustration-wrapper" style={{ position: 'relative', width: '100%', height: '100%', minHeight: 280 }}>
    <LeftMovablePart />
    <svg viewBox="0 0 380 300" style={{ maxWidth: '100%', height: 'auto' }} fill="none" className="auth-ill-base">
      {/* Form block */}
      <rect x="145" y="95" width="130" height="95" rx="12" fill={`${lightBlue}25`} stroke={lightBlue} strokeWidth="2" />
      <rect x="165" y="118" width="90" height="10" rx="5" fill={lightBlue} opacity={0.7} />
      <rect x="165" y="140" width="90" height="10" rx="5" fill={lightBlue} opacity={0.7} />
      <rect x="165" y="162" width="90" height="10" rx="5" fill={lightBlue} opacity={0.7} />
      <rect x="165" y="182" width="55" height="14" rx="7" fill={darkBlue} opacity={0.85} />
      {/* Password dots */}
      <rect x="300" y="50" width="55" height="28" rx="8" stroke={lightBlue} strokeWidth="2" strokeDasharray="5 4" fill="none" />
      <circle cx="315" cy="64" r="3" fill={lightBlue} />
      <circle cx="330" cy="64" r="3" fill={lightBlue} />
      <circle cx="345" cy="64" r="3" fill={lightBlue} />
      {/* Gear */}
      <circle cx="265" cy="125" r="14" stroke={darkBlue} strokeWidth="2" fill="none" />
      <circle cx="265" cy="125" r="5" fill={darkBlue} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const r = (deg * Math.PI) / 180
        const x1 = 265 + 10 * Math.cos(r)
        const y1 = 125 + 10 * Math.sin(r)
        const x2 = 265 + 14 * Math.cos(r)
        const y2 = 125 + 14 * Math.sin(r)
        return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke={darkBlue} strokeWidth="2" />
      })}
      {/* Key */}
      <circle cx="330" cy="170" r="8" stroke={darkBlue} strokeWidth="2" fill="none" />
      <path d="M338 170 L355 170 L355 182 L345 182" stroke={darkBlue} strokeWidth="2" fill="none" />
      <circle cx="350" cy="178" r="3" fill={darkBlue} />
      {/* Dashed connections */}
      <line x1="279" y1="135" x2="275" y2="145" stroke={lightBlue} strokeWidth="1" strokeDasharray="4 4" />
      <line x1="322" y1="162" x2="295" y2="155" stroke={lightBlue} strokeWidth="1" strokeDasharray="4 4" />
      {/* Plant + padlock */}
      <rect x="268" y="218" width="28" height="22" rx="6" fill={`${lightBlue}40`} stroke={darkBlue} strokeWidth="1" />
      <path d="M275 218 Q282 200 289 218" stroke={darkBlue} strokeWidth="2" fill="none" />
      <path d="M278 218 Q282 208 286 218" stroke={darkBlue} strokeWidth="1.5" fill="none" opacity={0.8} />
      <rect x="278" y="195" width="6" height="10" rx="2" fill={darkBlue} />
      <rect x="275" y="185" width="12" height="14" rx="3" fill={darkBlue} stroke={darkBlue} strokeWidth="1" />
      <line x1="304" y1="235" x2="304" y2="195" stroke={lightBlue} strokeWidth="1" strokeDasharray="4 4" />
      <line x1="304" y1="195" x2="330" y2="178" stroke={lightBlue} strokeWidth="1" strokeDasharray="4 4" />
      {/* Corner accent bottom-right */}
      <rect x="270" y="245" width="70" height="70" rx="18" fill={`${lightBlue}12`} stroke={lightBlue} strokeWidth="1" opacity={0.7} />
    </svg>
  </div>
)

/** Illustration 2: Login - person + form with 2 inputs + key, padlock */
const LoginIllustration = () => (
  <div className="auth-illustration-wrapper" style={{ position: 'relative', width: '100%', height: '100%', minHeight: 280 }}>
    <LeftMovablePart />
    <svg viewBox="0 0 380 300" style={{ maxWidth: '100%', height: 'auto' }} fill="none" className="auth-ill-base">
      {/* Form block - 2 fields for login */}
      <rect x="145" y="105" width="130" height="85" rx="12" fill={`${lightBlue}25`} stroke={lightBlue} strokeWidth="2" />
      <rect x="165" y="128" width="90" height="10" rx="5" fill={lightBlue} opacity={0.7} />
      <rect x="165" y="152" width="90" height="10" rx="5" fill={lightBlue} opacity={0.7} />
      <rect x="165" y="175" width="55" height="14" rx="7" fill={darkBlue} opacity={0.85} />
      {/* Padlock */}
      <rect x="295" y="55" width="24" height="28" rx="4" fill={darkBlue} stroke={darkBlue} strokeWidth="1" />
      <path d="M300 55 L300 48 Q300 40 307 40 L307 40 Q314 40 314 48 L314 55" stroke={darkBlue} strokeWidth="2" fill="none" />
      {/* Key */}
      <circle cx="340" cy="160" r="8" stroke={darkBlue} strokeWidth="2" fill="none" />
      <path d="M348 160 L362 160 L362 172 L352 172" stroke={darkBlue} strokeWidth="2" fill="none" />
      <circle cx="358" cy="168" r="3" fill={darkBlue} />
      {/* Dashed lines */}
      <line x1="319" y1="82" x2="275" y2="145" stroke={lightBlue} strokeWidth="1" strokeDasharray="4 4" />
      <line x1="332" y1="152" x2="300" y2="155" stroke={lightBlue} strokeWidth="1" strokeDasharray="4 4" />
      <line x1="307" y1="69" x2="332" y2="152" stroke={lightBlue} strokeWidth="1" strokeDasharray="4 4" />
      {/* Corner accent bottom-right */}
      <rect x="275" y="240" width="75" height="75" rx="18" fill={`${lightBlue}12`} stroke={lightBlue} strokeWidth="1" opacity={0.7} />
    </svg>
  </div>
)

export const AuthIllustration = ({ variant }: AuthIllustrationProps) => {
  return variant === 'register' ? <RegisterIllustration /> : <LoginIllustration />
}
