'use client'

import { useState, useEffect, useCallback } from 'react'
import { StudioTopBar } from './StudioTopBar'
import { StudioSidebar } from './StudioSidebar'
import { StudioTransportBar } from './StudioTransportBar'
import { StudioStatusFooter } from './StudioStatusFooter'
import { MasteringTab } from '@/components/rain/mastering/MasteringTab'
import { StemsTab } from '@/components/rain/tabs/StemsTab'
import { RepairTab } from '@/components/rain/tabs/RepairTab'
import { QCTab } from '@/components/rain/tabs/QCTab'
import { MetadataTab } from '@/components/rain/tabs/MetadataTab'
import { ExportTab } from '@/components/rain/tabs/ExportTab'
import { DistributeTab } from '@/components/rain/tabs/DistributeTab'
import { ProvenanceTab } from '@/components/rain/tabs/ProvenanceTab'
import { AnalyticsTab } from '@/components/rain/tabs/AnalyticsTab'
import { SpatialTab, PitchTab, ReferenceTab, AIETab, SettingsTab } from '@/components/rain/tabs/SecondaryTabs'
import { KeyboardShortcuts } from '@/components/rain/mastering/KeyboardShortcuts'
import { KeyboardShortcutsOverlay } from '@/components/rain/KeyboardShortcutsOverlay'
import { DataRain } from '@/components/rain/ui/DataRain'
// AuthProvider now lives in page.tsx (app-wide) so the landing hero can
// read enterprise status via useAuth() without restructuring.
import { AdminDoorModal } from '@/components/rain/admin/AdminDoorModal'
import { AdminConsole } from '@/components/rain/admin/AdminConsole'
import { FeedbackModal } from '@/components/rain/FeedbackModal'

/* ---------------------------------------------------------------------------
   Ambient background for studio view (Task 10 — replaced particles with data rain)
   - Single canvas-based Matrix-style data rain
   - Very subtle opacity so the studio UI stays the focus
   - Slow fall speed; keeps the glassmorphism panels readable
   --------------------------------------------------------------------------- */

interface StudioAppProps {
  onExit: () => void
}

export function StudioApp({ onExit }: StudioAppProps) {
  const [activeTab, setActiveTab] = useState('mastering')
  const [showShortcuts, setShowShortcuts] = useState(false)
  // Admin door state: doorOpen = login/setup modal; consoleOpen = full console overlay.
  const [doorOpen, setDoorOpen] = useState(false)
  const [consoleOpen, setConsoleOpen] = useState(false)

  // Listen for shortcuts toggle event from StudioTopBar and KeyboardShortcuts
  useEffect(() => {
    const handleToggle = () => setShowShortcuts((prev) => !prev)
    window.addEventListener('rain:shortcuts-toggle', handleToggle)
    return () => window.removeEventListener('rain:shortcuts-toggle', handleToggle)
  }, [])

  // The admin door trigger in StudioTopBar dispatches this event so it stays
  // a clean child without prop-drilling. The door modal decides setup-vs-login
  // on its own via the /api/rain/admin/status probe.
  useEffect(() => {
    const openDoor = () => setDoorOpen(true)
    const openConsole = () => setConsoleOpen(true)
    window.addEventListener('rain:admin-door-open', openDoor)
    window.addEventListener('rain:admin-console-open', openConsole)
    return () => {
      window.removeEventListener('rain:admin-door-open', openDoor)
      window.removeEventListener('rain:admin-console-open', openConsole)
    }
  }, [])

  // BETA-ANALYTICS: fire tab_viewed once per tab per browser session (not on
  // every re-render) — feeds getAverageFeatureDepth() in server-analytics.ts.
  // Best-effort: a failed beacon never affects the UI.
  useEffect(() => {
    const seenKey = `rain:tabs-seen:${activeTab}`
    if (typeof window === 'undefined' || sessionStorage.getItem(seenKey)) return
    sessionStorage.setItem(seenKey, '1')
    fetch('/api/rain/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'tab_viewed', metadata: { tab: activeTab } }),
    }).catch(() => {})
  }, [activeTab])

  const renderTab = () => {
    switch (activeTab) {
      case 'mastering': return <MasteringTab />
      case 'stems': return <StemsTab />
      case 'repair': return <RepairTab />
      case 'pitch': return <PitchTab />
      case 'spatial': return <SpatialTab />
      case 'qc': return <QCTab />
      case 'reference': return <ReferenceTab />
      case 'metadata': return <MetadataTab />
      case 'export': return <ExportTab />
      case 'distribute': return <DistributeTab />
      case 'provenance': return <ProvenanceTab />
      case 'aie': return <AIETab />
      case 'analytics': return <AnalyticsTab />
      case 'settings': return <SettingsTab />
      default: return <MasteringTab />
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background relative">
      {/* Background layer - data rain + gradient orb (Task 10) */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden>
        {/* Ambient data rain — very subtle so it reads as texture behind the glass panels */}
        <DataRain opacity={0.18} fontSize={12} columnWidth={16} speed={0.7} />

        {/* Gradient orb at bottom-center for glassmorphism effect */}
        <div
          className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full blur-3xl"
          style={{
            background: 'radial-gradient(circle, rgba(170, 255, 0, 0.15) 0%, rgba(139, 92, 246, 0.10) 40%, transparent 70%)',
          }}
        />
      </div>

      {/* Main content layer */}
      <div className="relative z-10 flex flex-col min-h-screen">
        <StudioTopBar onExit={onExit} />
        <div className="flex-1 flex min-h-0">
          <StudioSidebar active={activeTab} onSelect={setActiveTab} />
          <div className="flex-1 flex flex-col min-w-0">
            <main className="flex-1 overflow-y-auto rain-scrollbar p-4">
              {renderTab()}
            </main>
            <StudioTransportBar />
            <StudioStatusFooter />
          </div>
        </div>
      </div>
      <KeyboardShortcuts />
      <KeyboardShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {/* Enterprise Admin Door — login/setup modal */}
      {doorOpen && (
        <AdminDoorModal
          onClose={() => setDoorOpen(false)}
          onSuccess={() => {
            setDoorOpen(false)
            setConsoleOpen(true)
          }}
        />
      )}
      {/* Enterprise Admin Console — full overlay, only meaningful when authed */}
      {consoleOpen && <AdminConsole onClose={() => setConsoleOpen(false)} />}
      {/* Free Beta Feedback Widget */}
      <FeedbackModal />
    </div>
  )
}
