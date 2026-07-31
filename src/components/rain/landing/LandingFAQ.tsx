'use client'

/**
 * RAIN V6 — Landing Page FAQ Section
 *
 * Accordion-style frequently-asked-questions section answering the most
 * common beta-user concerns: data privacy, audio quality, export formats,
 * pricing, provenance, and the beta timeline. Uses the existing shadcn/ui
 * Accordion component for accessibility (keyboard navigation, ARIA).
 *
 * Positioned before the footer — the last trust-building section before the
 * visitor decides to launch the studio or sign up.
 */

import { useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, HelpCircle, ShieldCheck, Music, Download, DollarSign, KeyRound, Clock } from 'lucide-react'

interface FAQItem {
  id: string
  question: string
  answer: string
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  accent: string
}

const FAQS: FAQItem[] = [
  {
    id: 'privacy',
    question: 'Does my audio leave my device?',
    answer:
      'No. On the free path, all DSP — the 16-stage mastering pipeline, LUFS measurement, true-peak detection, MP3/WAV encoding — runs entirely in your browser via the Web Audio API. Your audio files are never uploaded to a server. The only server calls are anonymous analytics events (session loads, render counts) which help us measure beta usage. Sign up only if you want to persist sessions and render history to an account.',
    icon: ShieldCheck,
    accent: '#10B981',
  },
  {
    id: 'quality',
    question: 'Is the mastering quality professional-grade?',
    answer:
      'Yes. The DSP engine implements ITU-R BS.1770-4 K-weighted LUFS, 4× polyphase oversampling for true-peak detection, RBJ biquad filters, 3-band multiband compression, M/S processing, and a look-ahead limiter. WAV exports are lossless PCM (24-bit / 48 kHz). MP3 exports use real LAME encoding at 320 kbps CBR with TPDF dither. Every measurement is real — no simulated numbers.',
    icon: Music,
    accent: '#AAFF00',
  },
  {
    id: 'formats',
    question: 'What export formats are supported?',
    answer:
      'WAV 24-bit (authoritative master, 48 kHz, TPDF dither), WAV 16-bit (CD-compatible), MP3 320 kbps (streaming distribution), and Dolby Atmos 7.1.4 packages (.atmos.wav + ADM XML sidecar + spatial.json + README + MANIFEST with SHA-256). Every export can embed an Ed25519 RAIN-CERT provenance certificate and metadata tags (ID3v2 for MP3, RIFF LIST/INFO for WAV).',
    icon: Download,
    accent: '#06B6D4',
  },
  {
    id: 'pricing',
    question: 'How much does it cost?',
    answer:
      'Every feature is unlocked during the free public beta — no paywalls, no credit card, no time limit. 12-stem separation, spatial audio, DDEX distribution, Ed25519 provenance, the AI Co-Master Engineer — all free. We\'re building the product roadmap based on beta feedback. Pricing tiers will be introduced post-beta for enterprise/team features, but the core mastering studio will remain accessible.',
    icon: DollarSign,
    accent: '#F59E0B',
  },
  {
    id: 'provenance',
    question: 'What is RAIN-CERT provenance?',
    answer:
      'Every render can be signed with an Ed25519 key (generated in your browser via WebCrypto, stored in IndexedDB). The certificate embeds the input/output SHA-256 hashes, the mastering settings, and a C2PA v2.2-style manifest with assertions. The public key is embedded in the certificate, so anyone can verify the signature later — proving the audio was mastered in RAIN V6 and hasn\'t been tampered with. This is especially valuable for copyright disputes and supply-chain provenance.',
    icon: KeyRound,
    accent: '#8B5CF6',
  },
  {
    id: 'beta',
    question: 'How long is the beta, and what happens after?',
    answer:
      'The beta runs while we build the product roadmap — there\'s no fixed end date. Your feedback directly shapes what we build next. When the beta ends, your existing sessions and renders (if you\'ve signed up) will carry over to the production release. Anonymous usage data is preserved as aggregate analytics. We\'ll give at least 30 days notice before any pricing changes, and the core mastering studio will remain accessible.',
    icon: Clock,
    accent: '#F97316',
  },
]

export function LandingFAQ() {
  const [openId, setOpenId] = useState<string | null>('privacy')

  return (
    <section className="relative py-16 px-4 border-t border-rain-border/50" id="faq">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[rgba(170,255,0,0.25)] bg-[rgba(170,255,0,0.06)] text-[10px] font-mono uppercase tracking-wider text-[#AAFF00] mb-4">
            <HelpCircle className="w-3 h-3" />
            Frequently Asked
          </div>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
            Questions, answered.
          </h2>
          <p className="text-sm text-muted-foreground max-w-lg mx-auto">
            Everything you need to know about the free beta, data privacy, and
            what happens after launch.
          </p>
        </div>

        {/* Accordion */}
        <div className="space-y-2.5">
          {FAQS.map((faq, i) => {
            const isOpen = openId === faq.id
            const Icon = faq.icon
            return (
              <motion.div
                key={faq.id}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
              >
                <div
                  className={`rounded-xl border transition-all duration-200 overflow-hidden ${
                    isOpen
                      ? 'border-[rgba(170,255,0,0.25)] bg-[rgba(14,16,22,0.6)]'
                      : 'border-rain-border/60 bg-rain-surface-2/30 hover:border-rain-border'
                  }`}
                  style={
                    isOpen
                      ? { boxShadow: `0 0 24px -8px ${faq.accent}30` }
                      : undefined
                  }
                >
                  <button
                    onClick={() => setOpenId(isOpen ? null : faq.id)}
                    className="w-full flex items-center gap-3 px-4 py-4 text-left group"
                    aria-expanded={isOpen}
                    aria-controls={`faq-answer-${faq.id}`}
                  >
                    {/* Icon */}
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
                      style={{
                        background: isOpen ? `${faq.accent}15` : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${isOpen ? `${faq.accent}40` : 'rgba(255,255,255,0.06)'}`,
                      }}
                    >
                      <Icon
                        className="w-4 h-4 transition-colors"
                        style={{ color: isOpen ? faq.accent : '#94a3b8' }}
                      />
                    </div>
                    {/* Question */}
                    <span className={`flex-1 text-sm font-semibold transition-colors ${isOpen ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`}>
                      {faq.question}
                    </span>
                    {/* Chevron */}
                    <ChevronDown
                      className={`w-4 h-4 flex-shrink-0 transition-all duration-200 ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                      style={{ color: isOpen ? faq.accent : '#64748b' }}
                    />
                  </button>
                  {/* Answer */}
                  <div
                    id={`faq-answer-${faq.id}`}
                    className="grid transition-all duration-300 ease-out"
                    style={{
                      gridTemplateRows: isOpen ? '1fr' : '0fr',
                    }}
                  >
                    <div className="overflow-hidden">
                      <div className="px-4 pb-4 pl-[60px] pr-8">
                        <div
                          className="w-0.5 h-full absolute left-[44px] top-0 rounded-full opacity-30"
                          style={{ backgroundColor: faq.accent, height: 'calc(100% - 32px)', marginTop: '0px' }}
                          aria-hidden
                        />
                        <p className="text-[13px] leading-relaxed text-muted-foreground relative">
                          {faq.answer}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>

        {/* Still have questions? CTA */}
        <div className="text-center mt-10">
          <p className="text-[11px] text-muted-foreground font-mono">
            Still have questions?{' '}
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('rain:feedback-open'))}
              className="text-[#AAFF00] hover:underline"
            >
              Send us feedback
            </button>
            {' '}— we read every message.
          </p>
        </div>
      </div>
    </section>
  )
}
