'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Bot, Copy, Loader2, Send, Sparkles, User } from 'lucide-react'
import type { AssistantMessage, MacroValues } from '@/lib/rain/types'
import { useSessionStore } from '@/lib/rain/store'
import { recordAiStat } from '@/lib/rain/analytics'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const QUICK_PROMPTS = [
  'Brighten and widen for Spotify',
  'Warm tape saturation with tight low end',
  'Punchy hip-hop master for Apple Music',
  'Clean and transparent for classical',
  'Loud and competitive for CD',
  'Add air and space for ambient',
]

export function AssistantPanel() {
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hi — I\'m your AI Co-Master Engineer. Describe the sound you want in plain English and I\'ll suggest the 7 macros with confidence scoring. Try "Brighten and widen for Spotify" or "Warm tape saturation with tight low end".',
      timestamp: Date.now(),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const inputAnalysis = useSessionStore((s) => s.inputAnalysis)
  const genre = useSessionStore((s) => s.genre)
  const platform = useSessionStore((s) => s.platform)
  const macros = useSessionStore((s) => s.macros)
  const setMacros = useSessionStore((s) => s.setMacros)
  const setMacroSource = useSessionStore((s) => s.setMacroSource)

  const send = useCallback(async (text: string) => {
    if (!text.trim() || loading) return
    const userMsg: AssistantMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    setMessages((m) => [...m, userMsg])
    setInput('')
    setLoading(true)
    // P3-ANALYTICS: measure real AI suggestion latency and persist it.
    const aiStart = Date.now()
    try {
      const res = await fetch('/api/rain/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          analysis: inputAnalysis ? {
            lufs: inputAnalysis.lufs,
            truePeak: inputAnalysis.truePeak,
            rms: inputAnalysis.rms,
            dynamicRange: inputAnalysis.dynamicRange,
            bpm: inputAnalysis.bpm,
            key: inputAnalysis.key,
            genre, platform,
          } : null,
          currentMacros: macros,
        }),
      })
      const data = await res.json()
      const aiMsg: AssistantMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: data.reply ?? 'Sorry, I couldn\'t process that request.',
        timestamp: Date.now(),
        suggestions: data.suggestions,
        report: data.report,
      }
      setMessages((m) => [...m, aiMsg])

      // Apply suggested macros if present
      if (data.suggestions?.macros) {
        const patch: Partial<MacroValues> = {}
        const validKeys = ['brighten', 'glue', 'width', 'punch', 'warmth', 'space', 'repair'] as const
        for (const k of validKeys) {
          if (typeof data.suggestions.macros[k] === 'number') {
            patch[k] = data.suggestions.macros[k]
          }
        }
        if (Object.keys(patch).length > 0) {
          setMacros(patch)
          setMacroSource('MODEL', data.suggestions.confidence ?? 0)
        }
      }

      // P3-ANALYTICS: persist the real AI suggestion latency.
      void recordAiStat(Date.now() - aiStart).catch(() => {
        /* swallow — analytics failure must not break AI flow */
      })
    } catch {
      const errMsg: AssistantMessage = {
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: 'I couldn\'t reach the AI service. Please try again in a moment.',
        timestamp: Date.now(),
      }
      setMessages((m) => [...m, errMsg])
    } finally {
      setLoading(false)
    }
  }, [loading, inputAnalysis, genre, platform, macros, setMacros, setMacroSource])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  // Expose the send function to the parent via store-less callback.
  // AUDIT2-3 FIX: return cleanup so the global is deleted when the panel
  // unmounts — otherwise it keeps firing send() with stale inputAnalysis/macros.
  useEffect(() => {
    const w = window as unknown as { __rainAiSuggest?: () => void }
    w.__rainAiSuggest = () => {
      void send('Suggest macros for this track based on its analysis.')
    }
    return () => {
      delete w.__rainAiSuggest
    }
  }, [send])

  return (
    <div className="rain-glass rounded-lg flex flex-col h-full min-h-[400px]">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-rain-border">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-rain-accent/15 border border-rain-accent/40 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-rain-accent" />
          </div>
          <div>
            <div className="text-xs font-semibold">AI Co-Master Engineer</div>
            <div className="text-[9px] font-mono text-muted-foreground">Claude Sonnet · 7-macro JSON contract</div>
          </div>
        </div>
        <Sparkles className="w-3.5 h-3.5 text-rain-accent" />
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 rain-scrollbar min-h-0">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin text-rain-accent" />
            Analyzing...
          </div>
        )}
      </div>

      <div className="px-3 pb-2 flex gap-1.5 flex-wrap">
        {QUICK_PROMPTS.slice(0, 4).map((q) => (
          <button
            key={q}
            onClick={() => void send(q)}
            disabled={loading}
            className="text-[10px] px-2 py-1 rounded-md bg-rain-surface-2 border border-rain-border hover:border-rain-accent/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      <div className="p-3 border-t border-rain-border flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void send(input) }}
          placeholder="Describe the sound you want..."
          disabled={loading}
          className="flex-1 bg-rain-surface-2 border border-rain-border rounded-md px-3 py-2 text-xs focus:outline-none focus:border-rain-accent/50 disabled:opacity-50"
        />
        <button
          onClick={() => void send(input)}
          disabled={loading || !input.trim()}
          className="p-2 rounded-md bg-rain-accent text-black hover:scale-105 active:scale-95 transition-transform disabled:opacity-50 disabled:hover:scale-100"
          aria-label="Send message"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: AssistantMessage }) {
  const isUser = message.role === 'user'
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      <div
        className={`w-6 h-6 rounded-md flex-shrink-0 flex items-center justify-center ${
          isUser
            ? 'bg-rain-surface-3 border border-rain-border'
            : 'bg-rain-accent/15 border border-rain-accent/40'
        }`}
      >
        {isUser ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3 text-rain-accent" />}
      </div>
      <div className={`max-w-[85%] ${isUser ? 'text-right' : ''}`}>
        <div
          className={`rounded-md px-3 py-2 text-xs ${
            isUser
              ? 'bg-rain-surface-2 border border-rain-border'
              : 'bg-rain-surface-2 border border-rain-accent/20'
          }`}
        >
          {message.content}
        </div>
        {message.suggestions && (
          <div className="mt-2 rain-panel rounded-md p-2.5 border border-rain-accent/30">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Sparkles className="w-3 h-3 text-rain-accent" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-rain-accent">
                Macro Suggestion · {message.suggestions.confidence}% confidence
              </span>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-2">
              {(['brighten', 'glue', 'width', 'punch', 'warmth', 'space', 'repair'] as const).map((k) => {
                const v = message.suggestions!.macros[k]
                if (typeof v !== 'number') return null
                return (
                  <div key={k} className="text-center">
                    <div className="text-[9px] font-mono uppercase text-muted-foreground">{k.slice(0, 3)}</div>
                    <div className="text-xs font-mono font-bold text-rain-accent">{v.toFixed(1)}</div>
                  </div>
                )
              })}
            </div>
            <div className="text-[10px] text-muted-foreground mb-1.5">{message.suggestions.reasoning}</div>
            {message.suggestions.tensions.length > 0 && (
              <div className="space-y-0.5">
                {message.suggestions.tensions.map((t, i) => (
                  <div key={i} className="text-[10px] text-orange-400 flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-orange-400" />
                    {t}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {message.report && (
          <MasteringReportBlock report={message.report} />
        )}
        <div className="text-[9px] text-muted-foreground/60 mt-1 font-mono">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </motion.div>
  )
}

function MasteringReportBlock({ report }: { report: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(report).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [report])
  return (
    <Card className="mt-2 p-0 gap-2 bg-rain-surface-2 border-rain-accent/20 py-3">
      <CardHeader className="pb-1 px-3">
        <CardTitle className="text-[10px] font-mono uppercase tracking-wider text-rain-accent flex items-center justify-between">
          <span>Mastering Report</span>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-rain-border bg-rain-surface-3 hover:border-rain-accent/50 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Copy report"
          >
            <Copy className="w-2.5 h-2.5" />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pt-0">
        <div className="text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed">
          {report}
        </div>
      </CardContent>
    </Card>
  )
}
