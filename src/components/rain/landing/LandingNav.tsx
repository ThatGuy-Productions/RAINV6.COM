'use client'

import { motion } from 'framer-motion'
import { Terminal } from 'lucide-react'
import { RAIN_BRAND } from '@/lib/rain/constants'

interface LandingNavProps {
  onLaunch: () => void
}

export function LandingNav({ onLaunch }: LandingNavProps) {
  return (
    <motion.header
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="sticky top-0 z-40 border-b border-rain-border/50 backdrop-blur-xl bg-background/70"
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <a href="#" className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-md bg-rain-accent flex items-center justify-center rain-glow-soft group-hover:scale-105 transition-transform">
            <span className="font-mono font-bold text-black text-base">R∞</span>
          </div>
          <div className="hidden sm:block">
            <div className="font-bold text-sm leading-tight">
              {RAIN_BRAND.name} <span className="text-rain-accent">V6</span>
            </div>
            <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider leading-tight">
              Audio Operating System
            </div>
          </div>
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm">
          <a href="#demo" className="text-muted-foreground hover:text-foreground transition-colors">Demo</a>
          <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors">Features</a>
          <a href="#architecture" className="text-muted-foreground hover:text-foreground transition-colors">Architecture</a>
          <a href="#pricing" className="text-muted-foreground hover:text-foreground transition-colors">Pricing</a>
          <a href="#faq" className="text-muted-foreground hover:text-foreground transition-colors">FAQ</a>
          <a href="#pricing" className="text-muted-foreground hover:text-foreground transition-colors">Free Beta</a>
        </nav>

        <div className="flex items-center gap-2">
          <button
            onClick={onLaunch}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-rain-accent text-black text-sm font-semibold hover:scale-[1.02] active:scale-95 transition-transform"
          >
            <Terminal className="w-3.5 h-3.5" />
            Launch Studio
          </button>
        </div>
      </div>
    </motion.header>
  )
}
