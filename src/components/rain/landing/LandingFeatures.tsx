'use client'

import { motion } from 'framer-motion'
import {
  Activity,
  AudioLines,
  Box,
  Cpu,
  Fingerprint,
  Globe,
  Layers,
  Mic2,
  Music2,
  ShieldCheck,
  Sliders,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { Card3D } from '@/components/rain/ui/Card3D'

interface Feature {
  icon: React.ReactNode
  title: string
  description: string
  color: string
}

const FEATURES: Feature[] = [
  {
    icon: <Sliders className="w-5 h-5" />,
    title: '16-Stage Mastering Pipeline',
    description: 'From format normalization through DDEX distribution — every stage deterministic, every render bit-identical for the same input + params.',
    color: '#AAFF00',
  },
  {
    icon: <Layers className="w-5 h-5" />,
    title: '12-Stem BS-RoFormer Separation',
    description: 'Four-pass cascade: vocals, backing, drums, bass, guitar, piano, kick, snare, hats, percussion, ambience, other. SAIL v2 stem-aware limiting.',
    color: '#F97316',
  },
  {
    icon: <Wand2 className="w-5 h-5" />,
    title: 'AI Co-Master Engineer',
    description: 'Natural language → bounded 7-macro suggestions with confidence scoring. Tension-pair conflict detection. Before/after reports in plain English.',
    color: '#8B5CF6',
  },
  {
    icon: <Box className="w-5 h-5" />,
    title: 'Dolby Atmos Binaural',
    description: '7.1.4 bed with HOA path, SADIE II HRTFs (KU100). UPOLS convolution at 128-sample quantum. 20-30 simultaneous objects within budget.',
    color: '#06B6D4',
  },
  {
    icon: <ShieldCheck className="w-5 h-5" />,
    title: 'RAIN-CERT Provenance',
    description: 'Ed25519 RAIN-CERT provenance (AudioSeal watermark: future capability). C2PA v2.2 manifests, Chromaprint fingerprints. EU AI Act Article 50 compliant.',
    color: '#10B981',
  },
  {
    icon: <Globe className="w-5 h-5" />,
    title: '27 Platform Targets',
    description: 'Spotify -14, Apple -16, Atmos -18, CD -9, vinyl, EBU R128, ATSC A/85, ACX, podcasts, Qobuz, Tidal, plus 16 more — codec-aware penalties.',
    color: '#00D4FF',
  },
  {
    icon: <Mic2 className="w-5 h-5" />,
    title: 'Artist Identity Engine',
    description: '64-dimensional voice vector with adaptive EMA (α=0.90 stable, 0.60 cold-start). Personalizes after 5 sessions. HMAC-SHA256 signed export.',
    color: '#D946EF',
  },
  {
    icon: <Cpu className="w-5 h-5" />,
    title: 'Deterministic WASM Engine',
    description: 'RainDSP 64-bit double precision, K-weighted LUFS per BS.1770-4, 4× oversampled true-peak, monotonic-deque look-ahead limiter. Bit-identical output.',
    color: '#84CC16',
  },
  {
    icon: <Fingerprint className="w-5 h-5" />,
    title: 'DDEX ERN 4.3.2 Distribution',
    description: 'Full AI involvement fields per September 2025 standard. DDEX ERN 4.3.2 XML generation (manual distributor ingestion). ISRC/UPC generation.',
    color: '#F59E0B',
  },
  {
    icon: <AudioLines className="w-5 h-5" />,
    title: 'Real-time Web Audio Preview',
    description: 'Dual-path design — 32-bit float preview via Web Audio API (<50 ms latency) and 64-bit render via WASM. Never merge the paths.',
    color: '#EF4444',
  },
  {
    icon: <Music2 className="w-5 h-5" />,
    title: '7 Macro Controls',
    description: 'BRIGHTEN, GLUE, WIDTH, PUNCH, WARMTH, SPACE, REPAIR. Emotionally resonant controls mapping to bounded subsets of 46 DSP parameters.',
    color: '#AAFF00',
  },
  {
    icon: <Activity className="w-5 h-5" />,
    title: '18-Point QC Validation',
    description: 'LUFS target, true-peak, LRA, crest, DC offset, phase coherence, stereo width, bass mono, sibilance, rumble, high-freq air, sample rate, bit depth, RAIN-CERT, watermark, fingerprint.',
    color: '#8B5CF6',
  },
]

export function LandingFeatures() {
  return (
    <section id="features" className="relative py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-6">
        <div className="max-w-3xl mb-16">
          <motion.div
            initial={false}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-rain-border bg-rain-surface-2/60 text-xs font-mono uppercase tracking-wider mb-6"
          >
            <Sparkles className="w-3 h-3 text-rain-accent" />
            <span className="text-rain-accent">Engineered as a platform, not a feature list</span>
          </motion.div>
          <motion.h2
            initial={false}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl md:text-5xl font-bold tracking-tight mb-4"
          >
            Every subsystem <span className="rain-gradient-text-lime">integrates correctly</span>.
          </motion.h2>
          <motion.p
            initial={false}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-lg text-muted-foreground"
          >
            No placeholders. No simulated functionality. Every workflow functions, every API
            communicates with real services, every screen reflects real application state.
          </motion.p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={false}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{
                duration: 0.5,
                delay: Math.floor(i / 3) * 0.15,
                ease: [0.25, 0.46, 0.45, 0.94],
              }}
            >
              <Card3D
                glowColor={f.color}
                intensity={10}
                icon={
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center border"
                    style={{
                      color: f.color,
                      borderColor: `${f.color}40`,
                      background: `${f.color}10`,
                    }}
                  >
                    {f.icon}
                  </div>
                }
              >
                {/* Feature count badge — positioned relative to the Card3D
                    (children wrapper has no `position: relative` so this
                    absolute element resolves to the Card3D's `relative`). */}
                <div
                  className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center border font-mono text-[10px] font-semibold leading-none"
                  style={{
                    borderColor: `${f.color}30`,
                    color: `${f.color}80`,
                    background: `${f.color}08`,
                    boxShadow: `0 0 0 1px ${f.color}15`,
                  }}
                >
                  {String(i + 1).padStart(2, '0')}
                </div>

                <h3 className="font-semibold text-base mb-1.5 text-foreground pr-8">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
              </Card3D>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
