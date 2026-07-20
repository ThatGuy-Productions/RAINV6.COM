'use client'

/**
 * PartnerLogos — horizontal marquee banner for RAIN V6.
 *
 * Sits as a slim, sticky strip directly below the main landing nav and runs
 * the four partner brand identities across the screen in a seamless infinite
 * marquee. Each logo is rendered as a compact, single-line inline mark so it
 * fits the slim banner height while preserving its distinct identity:
 *
 *   1. LABELGRID          — wordmark + technical grid overlay (inline)
 *   2. WAVECHIP            — circuit trace + wordmark + waveform + chip
 *   3. THATGUY PRODUCTIONS — crown + film reel emblem + inline wordmark
 *   4. HEARTFIRE SOUND     — flame emblem + heavy wordmark + sound bars
 *
 * Logos inherit `currentColor` (muted slate) and brighten to pure white with
 * a lime glow on hover. A slow shimmer sweep crosses the row on a loop.
 */

import { motion } from 'framer-motion'

/* ---------------------------------------------------------------------------
   Compact inline logo marks (single-line, fit a ~44px tall banner)
   --------------------------------------------------------------------------- */

function LabelGridMark() {
  return (
    <div className="relative flex items-center" aria-label="LABELGRID">
      <div className="relative">
        {/* Grid overlay — horizontal rules */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <div className="absolute left-0 right-0 top-0 h-px bg-current opacity-15" />
          <div className="absolute left-0 right-0 top-1/2 h-px bg-current opacity-15" />
          <div className="absolute left-0 right-0 bottom-0 h-px bg-current opacity-15" />
        </div>
        <span
          className="relative block text-[13px] font-semibold tracking-[0.22em] uppercase px-1"
          style={{ fontFamily: "'Arial Narrow', 'Helvetica Neue', sans-serif" }}
        >
          LABELGRID
        </span>
      </div>
    </div>
  )
}

function WaveChipMark() {
  return (
    <div className="flex items-center gap-1.5" aria-label="WAVECHIP">
      {/* Circuit traces */}
      <svg width="18" height="14" viewBox="0 0 26 22" fill="none" aria-hidden className="opacity-80">
        <rect x="1" y="2" width="3" height="3" fill="currentColor" />
        <rect x="1" y="17" width="3" height="3" fill="currentColor" />
        <rect x="11" y="9" width="3" height="3" fill="currentColor" />
        <path d="M2.5 5 L2.5 9 L12.5 9" stroke="currentColor" strokeWidth="1" fill="none" />
        <path d="M2.5 17 L2.5 13 L12.5 13" stroke="currentColor" strokeWidth="1" fill="none" />
        <path d="M12.5 10.5 L18 10.5" stroke="currentColor" strokeWidth="1" fill="none" />
      </svg>
      <span
        className="text-[12px] font-bold tracking-[0.16em] uppercase"
        style={{ fontFamily: "'Arial Narrow', 'Helvetica Neue', sans-serif" }}
      >
        WAVECHIP
      </span>
      {/* Waveform bars */}
      <div className="flex items-end gap-[2px] h-2.5" aria-hidden>
        {[4, 7, 5, 9, 6, 8].map((h, i) => (
          <div key={i} className="w-[2px] bg-current" style={{ height: `${h}px`, opacity: 0.55 + (i % 3) * 0.15 }} />
        ))}
      </div>
      {/* Microchip */}
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden className="opacity-80">
        <rect x="5" y="5" width="10" height="10" stroke="currentColor" strokeWidth="1" fill="none" />
        <rect x="8" y="8" width="4" height="4" fill="currentColor" opacity="0.4" />
        {[7, 9.5, 12].map((y) => (
          <g key={y}>
            <line x1="3" y1={y} x2="5" y2={y} stroke="currentColor" strokeWidth="1" />
            <line x1="15" y1={y} x2="17" y2={y} stroke="currentColor" strokeWidth="1" />
          </g>
        ))}
      </svg>
    </div>
  )
}

function ThatGuyMark() {
  return (
    <div className="flex items-center gap-1.5" aria-label="THATGUY PRODUCTIONS">
      {/* Crown + film reel emblem (compact) */}
      <svg width="20" height="18" viewBox="0 0 34 30" fill="none" aria-hidden className="opacity-90">
        {/* Crown */}
        <path
          d="M6 10 L10 4 L13 8 L17 2 L21 8 L24 4 L28 10 L28 13 L6 13 Z"
          stroke="currentColor"
          strokeWidth="1.1"
          fill="none"
          strokeLinejoin="round"
        />
        <line x1="6" y1="13" x2="28" y2="13" stroke="currentColor" strokeWidth="1.1" />
        {/* Film reel */}
        <circle cx="17" cy="22" r="6.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
        <circle cx="17" cy="22" r="1.4" fill="currentColor" />
        {[
          [17, 17.2],
          [21.8, 22],
          [17, 26.8],
          [12.2, 22],
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="1" stroke="currentColor" strokeWidth="0.9" fill="none" />
        ))}
      </svg>
      <span
        className="text-[12px] font-medium tracking-[0.14em] uppercase leading-none"
        style={{ fontFamily: "'Didot', 'Bodoni 72', 'Playfair Display', Georgia, serif" }}
      >
        THATGUY
      </span>
      <span
        className="text-[8px] font-light tracking-[0.34em] uppercase leading-none opacity-65"
        style={{ fontFamily: "'Didot', 'Bodoni 72', 'Playfair Display', Georgia, serif" }}
      >
        PRODUCTIONS
      </span>
    </div>
  )
}

function HeartfireMark() {
  return (
    <div className="flex items-center gap-1.5" aria-label="HEARTFIRE SOUND">
      {/* Flame */}
      <svg width="13" height="16" viewBox="0 0 22 26" fill="none" aria-hidden className="opacity-90">
        <path
          d="M11 1 C13 6 17 8 17 14 C17 19 14 24 11 24 C8 24 5 19 5 14 C5 11 7 9 8 7 C8.5 9 10 10 11 9 C10 6 11 3 11 1 Z"
          stroke="currentColor"
          strokeWidth="1.1"
          fill="none"
          strokeLinejoin="round"
        />
        <path
          d="M11 13 C12 15 13.5 16 13.5 18 C13.5 20 12.3 21.5 11 21.5 C9.7 21.5 8.5 20 8.5 18 C8.5 16 10 15 11 13 Z"
          fill="currentColor"
          opacity="0.35"
        />
      </svg>
      <span
        className="text-[12px] font-extrabold tracking-[0.1em] uppercase leading-none"
        style={{ fontFamily: "'Arial Narrow', 'Helvetica Neue', Impact, sans-serif" }}
      >
        HEARTFIRE
      </span>
      <span
        className="text-[8px] font-medium tracking-[0.36em] uppercase leading-none opacity-75"
        style={{ fontFamily: "'Arial Narrow', 'Helvetica Neue', sans-serif" }}
      >
        SOUND
      </span>
      {/* Sound-wave bars */}
      <div className="flex items-end gap-[2px] h-2.5" aria-hidden>
        {[3, 6, 8, 6, 3].map((h, i) => (
          <div key={i} className="w-[2px] bg-current" style={{ height: `${h}px`, opacity: 0.5 + (i === 2 ? 0.4 : 0.1) }} />
        ))}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   The marquee banner
   --------------------------------------------------------------------------- */

const LOGOS = [
  { name: 'LABELGRID', Node: LabelGridMark },
  { name: 'WAVECHIP', Node: WaveChipMark },
  { name: 'THATGUY PRODUCTIONS', Node: ThatGuyMark },
  { name: 'HEARTFIRE SOUND', Node: HeartfireMark },
]

/** One copy of the marquee content: label chip + 4 logos separated by dots. */
function MarqueeSet({ prefix }: { prefix: string }) {
  return (
    <div className="flex items-center gap-7 shrink-0 pr-7">
      {/* Label chip */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-rain-accent rain-pulse" />
        <span className="text-[10px] font-mono uppercase tracking-[0.28em] text-muted-foreground whitespace-nowrap">
          Powering independent labels
        </span>
      </div>
      <span className="w-1 h-1 rounded-full bg-rain-border shrink-0" />
      {LOGOS.map((logo, i) => (
        <div key={`${prefix}-${i}`} className="flex items-center gap-7 shrink-0">
          <div className="text-muted-foreground/55 transition-colors duration-300 hover:text-white hover:drop-shadow-[0_0_8px_rgba(170,255,0,0.35)]">
            <logo.Node />
          </div>
          <span className="w-1 h-1 rounded-full bg-rain-border shrink-0" />
        </div>
      ))}
      {/* Platform footnote inline */}
      <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground/50 whitespace-nowrap shrink-0">
        DDEX · 27 platforms
      </span>
      <span className="w-1 h-1 rounded-full bg-rain-border shrink-0" />
    </div>
  )
}

export function PartnerLogos() {
  return (
    <div className="sticky top-16 z-30 border-b border-rain-border/40 backdrop-blur-xl bg-background/75">
      {/* Lime top hairline accent */}
      <div
        className="absolute top-0 inset-x-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(170,255,0,0.35) 50%, transparent 100%)' }}
        aria-hidden
      />
      <div className="relative overflow-hidden h-11 flex items-center">
        {/* Shimmer sweep — slow diagonal lime highlight crossing the row */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/4 z-10"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(170,255,0,0.08) 50%, transparent 100%)',
          }}
          animate={{ x: ['0%', '700%'] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'linear', repeatDelay: 2 }}
        />

        {/* Marquee track — two identical copies, translate -50% for seamless loop */}
        <motion.div
          className="flex items-center will-change-transform"
          animate={{ x: ['0%', '-50%'] }}
          transition={{ duration: 32, repeat: Infinity, ease: 'linear' }}
        >
          <MarqueeSet prefix="a" />
          <MarqueeSet prefix="b" />
        </motion.div>

        {/* Edge fades so logos ease in/out at the banner edges */}
        <div
          className="absolute left-0 top-0 bottom-0 w-16 pointer-events-none z-10"
          style={{ background: 'linear-gradient(90deg, var(--background, #0A0B0E) 0%, transparent 100%)' }}
          aria-hidden
        />
        <div
          className="absolute right-0 top-0 bottom-0 w-16 pointer-events-none z-10"
          style={{ background: 'linear-gradient(270deg, var(--background, #0A0B0E) 0%, transparent 100%)' }}
          aria-hidden
        />
      </div>
    </div>
  )
}
