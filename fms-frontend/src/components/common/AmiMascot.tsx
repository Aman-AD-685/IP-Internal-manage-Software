import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { markAmiGreetingShown, wasAmiGreetingShown } from '../../utils/amiGreeting'
import './AmiMascot.css'

type AmiMascotProps = {
  userName?: string | null
  durationMs?: number
}

export function WaveHand() {
  return (
    <motion.span
      className="ami-mascot__arm ami-mascot__arm--wave"
      animate={{ rotate: [8, -14, 8, -10, 8] }}
      transition={{ duration: 1.05, repeat: Infinity, ease: 'easeInOut' }}
      aria-hidden="true"
    />
  )
}

export function GreetingText() {
  const full = 'Hello'
  const [typed, setTyped] = useState('')

  useEffect(() => {
    let i = 0
    const timer = window.setInterval(() => {
      i += 1
      setTyped(full.slice(0, i))
      if (i >= full.length) window.clearInterval(timer)
    }, 90)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <motion.div
      className="ami-mascot__bubble"
      initial={{ opacity: 0, x: 10, y: 6 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ delay: 0.2, duration: 0.45, ease: 'easeOut' }}
    >
      {typed}
    </motion.div>
  )
}

export function AmiMascot({
  userName,
  durationMs = 60_000,
}: AmiMascotProps) {
  const [visible, setVisible] = useState(false)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!userName) {
      setVisible(false)
      return
    }
    // Once per login session only (not on every page or profile refresh).
    if (wasAmiGreetingShown() || startedRef.current) {
      setVisible(false)
      return
    }
    startedRef.current = true
    markAmiGreetingShown()
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), durationMs)
    return () => window.clearTimeout(timer)
  }, [durationMs, userName])

  return (
    <AnimatePresence>
      {visible ? (
        <motion.aside
          className="ami-mascot"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.96 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          whileHover={{ scale: 1.03 }}
          aria-live="polite"
        >
          <GreetingText />
          <motion.div
            className="ami-mascot__character"
            animate={{ y: [0, -2, 0] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
            aria-hidden="true"
          >
            <span className="ami-mascot__antenna" />
            <span className="ami-mascot__body">
              <span className="ami-mascot__eye ami-mascot__eye--left" />
              <span className="ami-mascot__eye ami-mascot__eye--right" />
              <span className="ami-mascot__smile" />
            </span>
            <span className="ami-mascot__arm ami-mascot__arm--rest" />
            <WaveHand />
            <span className="ami-mascot__leg ami-mascot__leg--left" />
            <span className="ami-mascot__leg ami-mascot__leg--right" />
            <span className="ami-mascot__shadow" />
          </motion.div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}
