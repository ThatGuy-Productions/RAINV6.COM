'use client'

import { Fragment } from 'react'
import { motion } from 'framer-motion'
import { ChevronRight, Cpu, Globe, ShieldCheck, Sparkles } from 'lucide-react'

const PIPELINE = [
  { n: 1, name: 'Format Normalization', desc: '48 kHz · 64-bit float stereo' },
  { n: 2, name: 'Provenance Record', desc: 'Ed25519 input hash · C2PA init' },
  { n: 3, name: 'Feature Extraction', desc: '43-dim vector: Loudness · Dynamics · Spectral · Stereo · Transient · Tonal' },
  { n: 4, name: 'AI Inference', desc: 'RainNet v2 → 46 ProcessingParams' },
  { n: 5, name: 'Reference Matching', desc: 'Genre-aware spectral targets' },
  { n: 6, name: 'Spectral Repair', desc: 'HPF · sibilance · rumble · smoothing' },
  { n: 7, name: 'Source Separation', desc: 'BS-RoFormer 4-pass → 12 stems' },
  { n: 8, name: 'Per-Stem Repair', desc: 'Individual stem QC' },
  { n: 9, name: 'Per-Stem Processing', desc: 'SAIL v2 stem-aware limiting' },
  { n: 10, name: 'Master Bus', desc: 'EQ · Multiband · Width · Groove · Life' },
  { n: 11, name: 'Loudness Targeting', desc: '27 platform targets' },
  { n: 12, name: 'Spatial Rendering', desc: 'Dolby Atmos HRTF binaural' },
  { n: 13, name: 'QC Validation', desc: '18 automated checks' },
  { n: 14, name: 'Forensic Watermark', desc: 'Ed25519 RAIN-CERT provenance (AudioSeal watermark: future capability)' },
  { n: 15, name: 'Output Packaging', desc: '24-bit WAV @ 48 kHz + 320 kbps MP3' },
  { n: 16, name: 'Distribution', desc: 'DDEX ERN 4.3.2 XML generation (manual distributor ingestion) · ISRC/UPC' },
]

const ARCH_LAYERS = [
  {
    icon: <Globe className="w-5 h-5" />,
    color: '#AAFF00',
    title: 'Browser',
    desc: 'React 19 · TypeScript 5 · Tailwind 4 · Web Audio API · Zustand 5 · TanStack Query',
    bullets: ['32-bit float preview (<50 ms)', 'WebGPU → WASM fallback', 'IndexedDB persistence'],
  },
  {
    icon: <Cpu className="w-5 h-5" />,
    color: '#8B5CF6',
    title: 'DSP Engine',
    desc: 'RainDSP 64-bit double precision · Deterministic · Biquad · Multiband · M/S · Limiter',
    bullets: ['K-weighted LUFS (BS.1770-4)', '4× oversampled true-peak', 'Monotonic-deque look-ahead'],
  },
  {
    icon: <Sparkles className="w-5 h-5" />,
    color: '#00D4FF',
    title: 'AI Inference',
    desc: 'RainNet v2 · ONNX Runtime Web · Claude Sonnet integration via z-ai-web-dev-sdk',
    bullets: ['Natural language → 7 macros', 'Tension-pair conflict detection', 'Confidence-scored suggestions'],
  },
  {
    icon: <ShieldCheck className="w-5 h-5" />,
    color: '#10B981',
    title: 'Provenance',
    desc: 'Ed25519 RAIN-CERT provenance (AudioSeal watermark: future capability) · C2PA v2.2 · Chromaprint · CBOR (RFC 8949) · DDEX ERN 4.3.2',
    bullets: ['EU AI Act Article 50 compliant', 'DDEX AI disclosure fields', 'ISRC / UPC-EAN-13 generation'],
  },
]

/** Pipeline stage card — used in both desktop and mobile layouts */
function StageCard({ stage, index }: { stage: (typeof PIPELINE)[number]; index: number }) {
  return (
    <motion.div
      initial={false}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.04, duration: 0.4 }}
      className="group relative rain-panel rounded-lg p-3 hover:border-rain-accent/50 transition-colors overflow-hidden"
    >
      {/* Sequential flow accent bar — left edge */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[2px] rain-stage-glow"
        style={{
          background: 'var(--rain-accent)',
          animationDelay: `${index * 0.25}s`,
        }}
      />

      {/* Top flow progress bar */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-rain-surface-3 overflow-hidden rounded-t-lg">
        <div
          className="h-full rain-stage-progress"
          style={{
            background: 'linear-gradient(90deg, transparent, var(--rain-accent), transparent)',
            animationDelay: `${index * 0.25}s`,
          }}
        />
      </div>

      <div className="flex items-start gap-3">
        <div className="text-2xl font-bold font-mono rain-gradient-text-lime leading-none">
          {String(stage.n).padStart(2, '0')}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm mb-0.5">{stage.name}</div>
          <div className="text-xs text-muted-foreground leading-tight">{stage.desc}</div>
        </div>
      </div>
    </motion.div>
  )
}

/** Connector arrow between stages in a row */
function FlowConnector() {
  return (
    <div className="flex-shrink-0 w-6 flex items-center justify-center relative">
      {/* Pulse line */}
      <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 rain-connector-line" />
      <ChevronRight className="w-3.5 h-3.5 text-rain-accent/60 relative z-10" />
    </div>
  )
}

export function LandingArchitecture() {
  // Split pipeline into rows of 4 for desktop layout
  const ROWS = [
    PIPELINE.slice(0, 4),
    PIPELINE.slice(4, 8),
    PIPELINE.slice(8, 12),
    PIPELINE.slice(12, 16),
  ]

  return (
    <section id="architecture" className="relative py-24 lg:py-32 border-t border-rain-border/50">
      <div className="max-w-7xl mx-auto px-6">
        <div className="max-w-3xl mb-16">
          <motion.h2
            initial={false}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl md:text-5xl font-bold tracking-tight mb-4"
          >
            One architecture. <span className="rain-gradient-text">One source of truth.</span>
          </motion.h2>
          <motion.p
            initial={false}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-lg text-muted-foreground"
          >
            The dual-path design separates 32-bit preview from 64-bit render — never merge them.
            Determinism guarantee: same input + same params + same WASM binary = bit-identical output.
          </motion.p>
        </div>

        {/* Architecture layers */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
          {ARCH_LAYERS.map((layer, i) => (
            <motion.div
              key={layer.title}
              initial={false}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.5 }}
              className="group rain-panel rounded-xl p-5 hover:border-rain-accent/30 transition-all duration-300"
              style={{ '--layer-color': layer.color } as React.CSSProperties}
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center mb-3 border transition-shadow duration-300 group-hover:shadow-[0_0_16px_-4px_var(--layer-color)]"
                style={{
                  color: layer.color,
                  borderColor: `${layer.color}40`,
                  background: `${layer.color}10`,
                }}
              >
                {layer.icon}
              </div>
              <h3 className="font-semibold mb-1">{layer.title}</h3>
              <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{layer.desc}</p>
              <ul className="space-y-1">
                {layer.bullets.map((b) => (
                  <li key={b} className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full" style={{ background: layer.color }} />
                    {b}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        {/* 16-stage pipeline header */}
        <motion.div
          initial={false}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-8"
        >
          <h3 className="text-2xl font-bold mb-2">The 16-Stage Mastering Pipeline</h3>
          <p className="text-sm text-muted-foreground">Every stage deterministic · Every render bit-identical</p>
        </motion.div>

        {/* Desktop pipeline — flex rows with connectors */}
        <div className="hidden lg:block space-y-3 relative">
          {/* Data flow particle — lime dot that traverses the entire pipeline */}
          <div className="rain-data-flow-particle" aria-hidden="true" />

          {ROWS.map((row, rowIdx) => (
            <Fragment key={rowIdx}>
              {/* Row of 4 stages with connector arrows */}
              <div className="flex items-stretch gap-0">
                {row.map((stage, idx) => (
                  <Fragment key={stage.n}>
                    <div className="flex-1 min-w-0">
                      <StageCard stage={stage} index={rowIdx * 4 + idx} />
                    </div>
                    {idx < 3 && <FlowConnector />}
                  </Fragment>
                ))}
              </div>

              {/* Vertical connector between rows (except after last row) */}
              {rowIdx < 3 && (
                <div className="flex justify-end pr-4 py-0.5">
                  <div className="flex flex-col items-center gap-0">
                    {/* Vertical pulse line */}
                    <div className="w-[2px] h-4 rain-connector-vline" />
                    <ChevronRight className="w-3 h-3 text-rain-accent/40 rotate-90" />
                  </div>
                </div>
              )}
            </Fragment>
          ))}
        </div>

        {/* Mobile/tablet pipeline — responsive grid without connectors */}
        <div className="lg:hidden grid sm:grid-cols-2 gap-3 relative">
          {/* Mobile data flow particle */}
          <div className="rain-data-flow-particle-sm" aria-hidden="true" />

          {PIPELINE.map((stage, i) => (
            <StageCard key={stage.n} stage={stage} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}
