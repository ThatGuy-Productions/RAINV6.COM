'use client'

import { useEffect, useState } from 'react'
import { LandingPage } from '@/components/rain/landing/LandingPage'
import { StudioApp } from '@/components/rain/layout/StudioApp'
import { WelcomeBootScreen } from '@/components/rain/WelcomeBootScreen'
import { AuthProvider } from '@/components/rain/admin/AuthContext'

type View = 'landing' | 'studio'

function readHashView(): View {
  if (typeof window === 'undefined') return 'landing'
  return window.location.hash === '#studio' ? 'studio' : 'landing'
}

/**
 * Page entry: toggles between marketing landing page and the studio app
 * based on the URL hash (#studio). The view state synchronizes with the
 * browser's location hash — an external system — which is the canonical
 * use case for an effect subscription.
 *
 * A one-shot cinematic WelcomeBootScreen overlay plays on first arrival
 * (per session, gated by sessionStorage). It is skipped entirely when the
 * user deep-links to #studio — they are returning to work, not arriving.
 */
export default function Home() {
  // mounted flag avoids hydration mismatch — server renders 'landing',
  // client swaps to the hash-derived view after mount.
  const [mounted, setMounted] = useState(false)
  const [view, setView] = useState<View>('landing')
  // booted gates the WelcomeBootScreen overlay — false until the boot
  // animation completes (or is skipped, or never played).
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    // Sync from URL hash on mount + whenever the hash changes.
    const sync = () => {
      setMounted(true)
      const v = readHashView()
      setView(v)
      // Skip the boot animation entirely when deep-linking to #studio.
      if (v === 'studio') {
        setBooted(true)
      }
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  const launchStudio = () => {
    if (typeof window !== 'undefined') window.location.hash = 'studio'
    setView('studio')
  }

  const exitToLanding = () => {
    if (typeof window !== 'undefined') window.location.hash = ''
    setView('landing')
    if (typeof window !== 'undefined') window.scrollTo(0, 0)
  }

  return (
    <AuthProvider>
      {mounted && view === 'studio' ? (
        <StudioApp onExit={exitToLanding} />
      ) : (
        <>
          <LandingPage onLaunch={launchStudio} />
          {mounted && !booted && (
            <WelcomeBootScreen onComplete={() => setBooted(true)} />
          )}
        </>
      )}
    </AuthProvider>
  )
}
