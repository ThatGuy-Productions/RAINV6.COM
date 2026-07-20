'use client'

import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { PRICING_TIERS } from '@/lib/rain/constants'

interface PricingProps {
  onLaunch: () => void
}

export function LandingPricing({ onLaunch }: PricingProps) {
  return (
    <section id="pricing" className="relative py-24 lg:py-32">
      <div
        className="absolute inset-0 rain-bg-dots opacity-30"
        aria-hidden
      />
      <div className="relative max-w-7xl mx-auto px-6">
        <div className="max-w-3xl mb-16">
          <motion.div
            initial={false}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-rain-border bg-rain-surface-2/60 text-xs font-mono uppercase tracking-wider mb-6"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rain-accent rain-pulse" />
            <span className="text-rain-accent">Free Public Beta — No Credit Card Required</span>
          </motion.div>
          <motion.h2
            initial={false}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl md:text-5xl font-bold tracking-tight mb-4"
          >
            Full capability.<br /><span className="rain-gradient-text-lime">Completely free.</span>
          </motion.h2>
          <motion.p
            initial={false}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-lg text-muted-foreground"
          >
            Every feature is unlocked — WAV + MP3 export, 12-stem separation, spatial audio,
            Ed25519 provenance, DDEX distribution. No paywalls, no gating.
            Audio never leaves your device.
          </motion.p>
        </div>

        <div className="grid md:grid-cols-1 lg:grid-cols-1 gap-4 max-w-xl mx-auto">
          {PRICING_TIERS.map((tier) => (
            <motion.div
              key={tier.slug}
              initial={false}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="relative rain-panel rounded-xl p-8 flex flex-col border-rain-accent/60 rain-glow-soft"
            >
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-rain-accent text-black text-[10px] font-bold uppercase tracking-wider">
                Full Access
              </div>
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: tier.accent }}
                  />
                  <h3 className="font-semibold text-lg">{tier.name}</h3>
                </div>
                <p className="text-sm text-rain-accent">{tier.tagline}</p>
              </div>
              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-rain-accent">$0</span>
                  <span className="text-sm text-muted-foreground">/forever</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1 font-mono">{tier.renders} renders &amp; exports</div>
              </div>
              <ul className="space-y-2 mb-8 flex-1 grid sm:grid-cols-2 gap-x-4 gap-y-2">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: tier.accent }} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={onLaunch}
                className="w-full py-3 rounded-md bg-rain-accent text-black text-base font-semibold hover:scale-[1.02] active:scale-95 transition-transform"
              >
                Launch Studio — It's Free
              </button>
            </motion.div>
          ))}
        </div>

        <div className="mt-12 text-center text-xs text-muted-foreground">
          <p>
            RAIN V6 Free Beta includes Ed25519 RAIN-CERT provenance, C2PA v2.2 manifests, and EU AI Act Article 50 compliance.
            <br />
            No credit card. No time limit. Audio never leaves your device.
          </p>
        </div>
      </div>
    </section>
  )
}
