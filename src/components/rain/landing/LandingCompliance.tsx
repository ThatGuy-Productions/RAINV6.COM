'use client'

import { motion } from 'framer-motion'
import { ShieldCheck } from 'lucide-react'

const COMPLIANCE = [
  { code: 'EU AI Act Art. 50', status: 'Active', deadline: '2026-08-02', color: '#AAFF00' },
  { code: 'DDEX ERN 4.3.2', status: 'Active', deadline: 'Sept 2025 standard', color: '#10B981' },
  { code: 'C2PA v2.2', status: 'Active', deadline: 'May 2025 release', color: '#00D4FF' },
  { code: 'RAIN-CERT', status: 'Active', deadline: 'Ed25519 signed', color: '#8B5CF6' },
  { code: 'Chromaprint', status: 'Active', deadline: 'LGPL 2.1', color: '#D946EF' },
  { code: 'ISO 3901 (ISRC)', status: 'Active', deadline: 'Per standard', color: '#84CC16' },
  { code: 'AES17 True Peak', status: 'Active', deadline: '4× oversampling', color: '#06B6D4' },
]

export function LandingCompliance() {
  return (
    <section id="compliance" className="relative py-24 lg:py-32 border-t border-rain-border/50">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-12 items-start">
          <div>
            <motion.div
              initial={false}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-rain-border bg-rain-surface-2/60 text-xs font-mono uppercase tracking-wider mb-6"
            >
              <ShieldCheck className="w-3 h-3 text-rain-accent" />
              <span className="text-rain-accent">Provenance Before Output</span>
            </motion.div>
            <motion.h2
              initial={false}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-4xl md:text-5xl font-bold tracking-tight mb-4"
            >
              Compliance is <span className="rain-gradient-text-lime">non-negotiable</span>.
            </motion.h2>
            <motion.p
              initial={false}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="text-lg text-muted-foreground mb-6"
            >
              The EU AI Act Article 50 deadline of August 2, 2026 is a hard constraint. RAIN
              implements full marking capabilities regardless of regulatory classification.
              Output hash verified against RAIN-CERT before session marked complete — no exceptions.
            </motion.p>
            <motion.div
              initial={false}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="space-y-3"
            >
              <div className="rain-panel rounded-lg p-4 border-l-2 border-l-rain-accent">
                <div className="font-semibold text-sm mb-1">Rule #1: Local-First Processing</div>
                <div className="text-xs text-muted-foreground">RainDSP WASM is the sole render engine. Audio never reaches S3 on the free path.</div>
              </div>
              <div className="rain-panel rounded-lg p-4 border-l-2 border-l-rain-accent">
                <div className="font-semibold text-sm mb-1">Rule #5: NORMALIZATION_VALIDATED Gate</div>
                <div className="text-xs text-muted-foreground"><code className="text-rain-accent">RAIN_NORMALIZATION_VALIDATED=true</code> → gate open → RainNet inference active.</div>
              </div>
              <div className="rain-panel rounded-lg p-4 border-l-2 border-l-rain-accent">
                <div className="font-semibold text-sm mb-1">Rule #7: Provenance Before Output</div>
                <div className="text-xs text-muted-foreground">Output hash verified against RAIN-CERT. RAIN-E305 on mismatch, RAIN-E306 on unsigned cert.</div>
              </div>
            </motion.div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {COMPLIANCE.map((c, i) => (
              <motion.div
                key={c.code}
                initial={false}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.04 }}
                className="rain-panel rounded-lg p-4"
              >
                <div className="flex items-start justify-between mb-2">
                  <div
                    className="w-2 h-2 rounded-full mt-1.5 rain-pulse"
                    style={{ background: c.color }}
                  />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    {c.status}
                  </span>
                </div>
                <div className="font-semibold text-sm mb-1">{c.code}</div>
                <div className="text-xs text-muted-foreground font-mono">{c.deadline}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
