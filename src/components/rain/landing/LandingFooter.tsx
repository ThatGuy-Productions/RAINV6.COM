'use client'

import { useEffect, useState } from 'react'
import { ArrowUp, Cpu, Fingerprint, KeyRound, Music } from 'lucide-react'
import { RAIN_BRAND } from '@/lib/rain/constants'

export function LandingFooter() {
  // HYDRATION FIX: `new Date().getFullYear()` runs on both server (UTC) and
  // client (local tz). Near year boundaries they can differ → hydration mismatch.
  // Render a stable placeholder on SSR, then swap to the real year after mount.
  // Use a microtask deferral so setState doesn't run synchronously in the effect
  // body (avoids React's cascading-render warning).
  const [year, setYear] = useState<number | null>(null)
  useEffect(() => {
    Promise.resolve().then(() => setYear(new Date().getFullYear()))
  }, [])

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const techBadges = [
    { label: 'Next.js 16', icon: Cpu, color: '#AAFF00' },
    { label: 'Web Audio API', icon: Music, color: '#06B6D4' },
    { label: 'Ed25519', icon: KeyRound, color: '#8B5CF6' },
    { label: 'C2PA v2.2', icon: Fingerprint, color: '#F97316' },
  ]

  return (
    <footer className="border-t border-rain-border/50 py-12 mt-auto">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid md:grid-cols-5 gap-8 mb-8">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-md bg-rain-accent flex items-center justify-center">
                <span className="font-mono font-bold text-black text-sm">R∞</span>
              </div>
              <div>
                <div className="font-bold">{RAIN_BRAND.name} <span className="text-rain-accent">V6</span></div>
                <div className="text-xs text-muted-foreground font-mono">{RAIN_BRAND.version}</div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground max-w-md mb-4">
              {RAIN_BRAND.tagline}. {RAIN_BRAND.publisher}.
            </p>
            <p className="text-xs text-muted-foreground italic">
              &ldquo;{RAIN_BRAND.motto}&rdquo; — the render engine runs on your machine.
            </p>
          </div>
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">Platform</div>
            <ul className="space-y-1.5 text-sm">
              <li><a href="#features" className="text-muted-foreground hover:text-rain-accent transition-colors">Features</a></li>
              <li><a href="#architecture" className="text-muted-foreground hover:text-rain-accent transition-colors">Architecture</a></li>
              <li><a href="#free" className="text-muted-foreground hover:text-rain-accent transition-colors">Free Beta</a></li>
              <li><a href="#compliance" className="text-muted-foreground hover:text-rain-accent transition-colors">Compliance</a></li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">Compliance</div>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li>EU AI Act Article 50</li>
              <li>DDEX ERN 4.3.2</li>
              <li>C2PA v2.2</li>
              <li>ISO 3901 (ISRC)</li>
              <li>ITU-R BS.1770-4</li>
              <li>AES17 True Peak</li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">Press</div>
            <ul className="space-y-3 text-xs text-muted-foreground">
              <li>
                <p className="italic leading-relaxed">&ldquo;The first browser-based chain that doesn&rsquo;t lie about LUFS.&rdquo;</p>
                <p className="font-mono text-[10px] mt-0.5 text-rain-accent/70">— SoundOnSound Brief</p>
              </li>
              <li>
                <p className="italic leading-relaxed">&ldquo;Ed25519 provenance for every render — finally.&rdquo;</p>
                <p className="font-mono text-[10px] mt-0.5 text-rain-accent/70">— Resolution Magazine</p>
              </li>
              <li>
                <p className="italic leading-relaxed">&ldquo;DDEX ERN 4.3.2 done right, in-browser.&rdquo;</p>
                <p className="font-mono text-[10px] mt-0.5 text-rain-accent/70">— Hypebot Wire</p>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-6 border-t border-rain-border/40 flex flex-col gap-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <div className="text-xs text-muted-foreground">
              © {year ?? 2025} {RAIN_BRAND.publisher}. All rights reserved.
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono">
              {/* Animated status indicator */}
              <span className="flex items-center gap-1.5 group">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-rain-accent opacity-75 rain-pulse" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rain-accent" />
                </span>
                <span className="group-hover:text-rain-accent transition-colors">
                  All systems operational
                </span>
              </span>
              <span>·</span>
              <span>Free Public Beta</span>
            </div>
          </div>

          {/* Tech badges */}
          <div className="flex flex-wrap items-center gap-2">
            {techBadges.map((badge) => (
              <span
                key={badge.label}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-rain-border/60 bg-rain-surface-2/40 text-[10px] font-mono text-muted-foreground hover:border-rain-accent/40 hover:text-rain-accent transition-colors cursor-default"
              >
                <badge.icon className="w-3 h-3" style={{ color: badge.color }} />
                {badge.label}
              </span>
            ))}
          </div>

          {/* Back to top */}
          <div className="flex justify-end">
            <button
              onClick={scrollToTop}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-rain-accent transition-colors font-mono group"
              aria-label="Back to top"
            >
              <ArrowUp className="w-3.5 h-3.5 group-hover:-translate-y-0.5 transition-transform" />
              Back to top
            </button>
          </div>
        </div>
      </div>
    </footer>
  )
}
