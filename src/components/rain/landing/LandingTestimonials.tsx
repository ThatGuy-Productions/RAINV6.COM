'use client'

import { motion } from 'framer-motion'
import { Quote, Star } from 'lucide-react'

/* ---------------------------------------------------------------------------
   Data — 6 fictional but realistic-sounding audio industry testimonials
   --------------------------------------------------------------------------- */
interface Testimonial {
  name: string
  role: string
  company: string
  initials: string
  /** Background gradient for the avatar circle */
  accent: string
  /** Secondary tint used for the avatar ring + glow */
  accentSoft: string
  quote: string
}

const TESTIMONIALS: Testimonial[] = [
  {
    name: 'Marcus Tindall',
    role: 'Mastering Engineer',
    company: 'Meridian Audio Labs',
    initials: 'MT',
    accent: 'linear-gradient(135deg, #AAFF00 0%, #84CC16 100%)',
    accentSoft: '#AAFF00',
    quote:
      "I A/B'd RAIN V6 against my SSL Fusion chain on 14 reference tracks. The K-weighted LUFS matching is within 0.3 LU of my hardware. The provenance cert is the cherry on top — clients love it.",
  },
  {
    name: 'Aria Chen',
    role: 'Producer · Billboard Top 40',
    company: 'Aria Music',
    initials: 'AC',
    accent: 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)',
    accentSoft: '#8B5CF6',
    quote:
      'The 16-stage pipeline does in 12 seconds what used to take me 40 minutes of A/B\'ing plugins. The AI Co-Master suggestions are genuinely musical, not just loudness-matching.',
  },
  {
    name: 'Damon Owusu',
    role: 'A&R',
    company: 'Velocity Records',
    initials: 'DO',
    accent: 'linear-gradient(135deg, #F97316 0%, #F59E0B 100%)',
    accentSoft: '#F97316',
    quote:
      "We've onboarded 23 artists to RAIN V6 for distribution prep. DDEX validation caught ISRC mismatches we'd have shipped to Spotify. The compliance dashboard alone pays for itself.",
  },
  {
    name: 'Sofia Reinhardt',
    role: 'Film Composer',
    company: 'Cinder & Ash',
    initials: 'SR',
    accent: 'linear-gradient(135deg, #00D4FF 0%, #06B6D4 100%)',
    accentSoft: '#00D4FF',
    quote:
      'Atmos binaural rendering directly in the browser is wild. I deliver stems to Netflix post houses that pass their QC on the first pass now. Ed25519 provenance saved a copyright dispute last month.',
  },
  {
    name: 'Kenji Watanabe',
    role: 'Indie Artist · 2M monthly listeners',
    company: 'Self-released',
    initials: 'KW',
    accent: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
    accentSoft: '#10B981',
    quote:
      'I master my own releases now. The genre presets get me 90% there, the macro knobs handle the rest. No more paying $200/track for online mastering services.',
  },
  {
    name: 'Priya Kowalski',
    role: 'Audio Archivist',
    company: 'National Sound Library',
    initials: 'PK',
    accent: 'linear-gradient(135deg, #D946EF 0%, #A855F7 100%)',
    accentSoft: '#D946EF',
    quote:
      "We use RAIN V6's repair module for 78 RPM transfers. The spectral repair at 0.4 intensity removes clicks without smearing transients. The C2PA manifest makes our preservation chain auditable.",
  },
]

const LOGOS = [
  'Meridian Audio Labs',
  'Velocity Records',
  'Northbound Studios',
  'Apex Post',
  'Cinder & Ash',
  'Helios Mastering',
  'Sonic Forge',
  'Tonal Atlas',
]

/* ---------------------------------------------------------------------------
   Section
   --------------------------------------------------------------------------- */
export function LandingTestimonials() {
  return (
    <section
      id="testimonials"
      className="relative py-24 lg:py-32 border-t border-rain-border/50"
    >
      {/* Subtle dotted background */}
      <div className="absolute inset-0 rain-bg-dots opacity-20" aria-hidden />

      <div className="relative max-w-7xl mx-auto px-6">
        {/* ----------------------------------------------------------------- */}
        {/* Header                                                            */}
        {/* ----------------------------------------------------------------- */}
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-16">
          <motion.div
            initial={false}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-2xl"
          >
            <div className="text-[10px] font-mono uppercase tracking-wider text-rain-accent mb-3">
              EARLY ADOPTERS · TRUSTED BY PROFESSIONALS
            </div>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
              What the <span className="rain-gradient-text">industry says</span>
            </h2>
            <p className="text-base md:text-lg text-muted-foreground leading-relaxed max-w-2xl">
              Mastering engineers, producers, and label A&R teams are running RAIN V6 in their
              daily pipeline.
            </p>
          </motion.div>

          {/* Live indicator */}
          <motion.div
            initial={false}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-rain-border bg-rain-surface-2/60 backdrop-blur text-xs font-mono uppercase tracking-wider self-start lg:self-end"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-rain-accent opacity-75 rain-pulse" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-rain-accent" />
            </span>
            <span className="text-rain-accent">Free Public Beta</span>
            <span className="text-muted-foreground">· every feature unlocked</span>
          </motion.div>
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* Testimonial grid                                                  */}
        {/* ----------------------------------------------------------------- */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {TESTIMONIALS.map((t, i) => (
            <motion.article
              key={t.name}
              initial={false}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{
                duration: 0.5,
                delay: (i % 3) * 0.08,
                ease: [0.25, 0.46, 0.45, 0.94],
              }}
              className="relative rain-panel rounded-lg p-5 border-l-2 border-l-rain-accent/30 hover:border-rain-accent/40 hover:shadow-[0_0_24px_rgba(170,255,0,0.08)] transition-all flex flex-col"
            >
              {/* Quote mark (decorative, top-left) */}
              <Quote
                className="w-8 h-8 text-rain-accent/15 absolute top-4 left-4"
                aria-hidden
              />

              {/* 5-star rating (top-right) */}
              <div className="flex items-center gap-0.5 mb-3 relative z-10 justify-end">
                {Array.from({ length: 5 }).map((_, idx) => (
                  <Star
                    key={idx}
                    className="w-3 h-3 fill-rain-accent text-rain-accent"
                    aria-hidden
                  />
                ))}
              </div>

              {/* Quote text */}
              <p className="relative z-10 italic text-[14px] md:text-[15px] leading-relaxed text-foreground/90 flex-1 pl-1">
                &ldquo;{t.quote}&rdquo;
              </p>

              {/* Divider */}
              <div className="rain-divider my-4" />

              {/* Person block */}
              <div className="flex items-center gap-3">
                {/* Avatar */}
                <div
                  className="relative w-[60px] h-[60px] rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    background: t.accent,
                    boxShadow: `0 0 18px -4px ${t.accentSoft}80`,
                  }}
                >
                  {/* Inner ring */}
                  <div className="absolute inset-0 rounded-full ring-1 ring-white/10" />
                  <span className="font-mono font-bold text-black text-sm tracking-wider">
                    {t.initials}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-foreground truncate">{t.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{t.role}</div>
                  <div className="mt-1.5 inline-flex items-center px-2 py-0.5 rounded-full border border-rain-border bg-rain-surface-3/60 text-[10px] font-mono text-muted-foreground">
                    {t.company}
                  </div>
                </div>
              </div>
            </motion.article>
          ))}
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* Trusted-by logo strip                                             */}
        {/* ----------------------------------------------------------------- */}
        <motion.div
          initial={false}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.15 }}
          className="mt-16"
        >
          <div className="text-center text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-5">
            Trusted across the pipeline
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {LOGOS.map((name) => (
              <span
                key={name}
                className="px-3 py-1 rounded-full border border-rain-border bg-rain-surface-2/60 text-[11px] font-mono text-muted-foreground hover:border-rain-accent/40 hover:text-foreground transition-colors cursor-default"
              >
                {name}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
