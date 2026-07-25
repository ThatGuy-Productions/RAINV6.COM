'use client'

/**
 * RAIN V6 — Temporary Service Notice Banner
 *
 * A dismissible banner that appears at the top of the landing page hero,
 * acknowledging the data loss incident and confirming it's resolved.
 * Dismissed state is tracked in sessionStorage so it doesn't reappear
 * during the same browsing session.
 *
 * This is a temporary component — remove once all affected users have
 * been re-contacted and re-registered.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, AlertTriangle, CheckCircle2 } from 'lucide-react'

const DISMISS_KEY = 'rain_incident_notice_dismissed_v1'

export function ServiceNoticeBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    try {
      const dismissed = sessionStorage.getItem(DISMISS_KEY)
      if (!dismissed) {
        // Small delay so it appears after the hero loads
        const timer = window.setTimeout(() => setShow(true), 800)
        return () => window.clearTimeout(timer)
      }
    } catch {
      // sessionStorage disabled — show the banner
      const timer = window.setTimeout(() => setShow(true), 800)
      return () => window.clearTimeout(timer)
    }
  }, [])

  const dismiss = () => {
    setShow(false)
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch { /* noop */ }
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -20, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -20, height: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="relative z-40 border-b border-amber-500/20 bg-amber-500/5 backdrop-blur-sm overflow-hidden"
        >
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
            {/* Icon */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            </div>

            {/* Message */}
            <div className="flex-1 min-w-0 text-[12px] md:text-[13px] leading-relaxed">
              <span className="text-amber-400 font-semibold">Service Notice:</span>{' '}
              <span className="text-muted-foreground">
                A database issue on July 20th may have affected some beta accounts. The issue is{' '}
              </span>
              <span className="text-[#AAFF00] font-semibold">resolved</span>
              <span className="text-muted-foreground">
                {' '}— if you can't log in, please re-register. We apologize for the inconvenience.
              </span>
            </div>

            {/* Dismiss */}
            <button
              onClick={dismiss}
              className="flex-shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dismiss notice"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
