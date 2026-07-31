'use client'

import Link from 'next/link'
import { ArrowLeft, Music, Sliders, Wrench, Image as ImageIcon, FileText, ArrowRight, ExternalLink } from 'lucide-react'
import { TOOLS, CATEGORY_LABELS, type ToolCategory } from '@/lib/rain/tools-catalog'
import { RAIN_BRAND } from '@/lib/rain/constants'

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Music, Sliders, Wrench, Image: ImageIcon, FileText,
}

const CATEGORIES: ToolCategory[] = ['audio-convert', 'audio-effects', 'audio-tools', 'image-convert', 'pdf-tools']

export default function ToolsPage() {
  return (
    <div className="min-h-screen bg-[#0a0c10] text-white">
      {/* Nav */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-[rgba(10,12,16,0.8)] border-b border-[rgba(170,255,0,0.1)]">
        <div className="max-w-6xl mx-auto h-14 px-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-7 h-7 rounded-md bg-[#AAFF00] flex items-center justify-center">
              <span className="font-mono font-bold text-black text-xs">R∞</span>
            </div>
            <span className="font-bold text-sm">{RAIN_BRAND.name} <span className="text-[#AAFF00]">Tools</span></span>
          </Link>
          <Link href="/" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to studio
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-12">
        {/* Hero */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[rgba(170,255,0,0.25)] bg-[rgba(170,255,0,0.06)] text-[10px] font-mono uppercase tracking-wider text-[#AAFF00] mb-4">
            <Wrench className="w-3 h-3" />
            Free Tools · No Sign Up · 100% In-Browser
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Free File Conversion Tools
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
            Real, working converters for audio, images, and PDFs. Every tool runs
            entirely in your browser — your files never leave your device. No
            upload limits, no watermarks, no sign-up required.
          </p>
        </div>

        {/* Tool categories */}
        {CATEGORIES.map((cat) => {
          const tools = TOOLS.filter((t) => t.category === cat)
          const meta = CATEGORY_LABELS[cat]
          const Icon = ICONS[meta.icon] || Wrench
          return (
            <section key={cat} className="mb-12">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-8 h-8 rounded-lg bg-[rgba(170,255,0,0.1)] border border-[rgba(170,255,0,0.2)] flex items-center justify-center">
                  <Icon className="w-4 h-4 text-[#AAFF00]" />
                </div>
                <h2 className="text-lg font-semibold">{meta.label}</h2>
                <span className="text-[11px] font-mono text-muted-foreground/60">{tools.length} tools</span>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {tools.map((tool) => (
                  <Link
                    key={tool.slug}
                    href={`/tools/${tool.slug}`}
                    className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 hover:border-[rgba(170,255,0,0.3)] hover:bg-white/[0.04] transition-all"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="text-sm font-semibold group-hover:text-[#AAFF00] transition-colors">
                        {tool.name}
                      </h3>
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-[#AAFF00] group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {tool.description}
                    </p>
                    <div className="mt-2.5 flex items-center gap-1.5">
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#AAFF00]/10 text-[#AAFF00]/80 border border-[#AAFF00]/20 uppercase">
                        .{tool.outputExt}
                      </span>
                      <span className="text-[9px] font-mono text-muted-foreground/50">
                        in-browser
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )
        })}

        {/* Honesty note */}
        <div className="mt-16 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <ExternalLink className="w-4 h-4 text-[#AAFF00]" />
            What's NOT here (and why)
          </h3>
          <p className="text-[12px] text-muted-foreground leading-relaxed mb-2">
            Some conversions aren't possible in a browser without massive dependencies:
          </p>
          <ul className="text-[11px] text-muted-foreground/70 space-y-1 ml-4">
            <li>• <strong>Video conversion</strong> — requires ffmpeg.wasm (25MB+ download)</li>
            <li>• <strong>AAC encoding</strong> — browsers have no AAC encoder</li>
            <li>• <strong>Word/Excel → PDF</strong> — complex binary format parsing</li>
            <li>• <strong>PSD → PNG</strong> — layered format needs a full parser</li>
            <li>• <strong>TTF → EOT</strong> — deprecated format with no encoder</li>
          </ul>
          <p className="text-[11px] text-muted-foreground/60 mt-2">
            We don't list tools that don't actually work. Every tool above performs a real conversion.
          </p>
        </div>
      </main>
    </div>
  )
}
