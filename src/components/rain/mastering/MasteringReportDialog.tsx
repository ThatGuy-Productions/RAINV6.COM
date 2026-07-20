'use client'

/**
 * RAIN V6 — Mastering Report Dialog (Wave 3 P2-3)
 *
 * Client-side dialog that calls /api/rain/suggest to fetch an LLM-generated
 * mastering report from the current session state (input analysis, output
 * analysis, macros, RAIN score). Handles the 403-tier-insufficient case by
 * showing an upgrade prompt instead of an error.
 *
 * The route is gated at the Independent tier (≥ $29/mo). The caller may
 * optionally send an `x-user-id` header — if absent, the route treats the
 * caller as Casual and returns 403, which we render as an upgrade prompt.
 */

import { useCallback, useState } from 'react'
import { Copy, FileText, Loader2, Lock } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useSessionStore } from '@/lib/rain/store'
import { notifyError } from '@/lib/rain/notifications'
import { PRICING_TIERS } from '@/lib/rain/constants'

interface MasteringReportDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'report'; text: string }
  | { kind: 'upgrade'; required: string; current: string }
  | { kind: 'error'; message: string }

export function MasteringReportDialog({ open, onOpenChange }: MasteringReportDialogProps) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [copied, setCopied] = useState(false)
  const inputAnalysis = useSessionStore((s) => s.inputAnalysis)
  const outputAnalysis = useSessionStore((s) => s.outputAnalysis)
  const macros = useSessionStore((s) => s.macros)
  const params = useSessionStore((s) => s.params)
  const rainScore = useSessionStore((s) => s.rainScore)
  const genre = useSessionStore((s) => s.genre)
  const platform = useSessionStore((s) => s.platform)

  const generate = useCallback(async () => {
    if (!inputAnalysis || !outputAnalysis) {
      setState({ kind: 'error', message: 'Run a render first — no output analysis available.' })
      return
    }
    setState({ kind: 'loading' })
    try {
      const res = await fetch('/api/rain/suggest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Optional identity header. In the sandbox there's no real auth, so
          // we omit it; the route returns 403 and we render an upgrade prompt.
          // To test the report end-to-end, seed an Independent-tier Account
          // and set its id here via localStorage: `localStorage.getItem('rain:user-id')`.
          ...(getDevUserIdHeader()),
        },
        body: JSON.stringify({
          input: serializeAnalysis(inputAnalysis, genre, platform),
          output: serializeAnalysis(outputAnalysis, genre, platform),
          params: params ?? macrosToParams(macros),
          score: rainScore,
        }),
      })
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}))
        setState({
          kind: 'upgrade',
          required: String(body.required ?? 'independent'),
          current: String(body.current ?? 'casual'),
        })
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setState({
          kind: 'error',
          message:
            typeof body.error === 'string'
              ? body.error
              : `Report request failed (HTTP ${res.status})`,
        })
        return
      }
      const body = await res.json().catch(() => ({}))
      const report = typeof body.report === 'string' ? body.report : ''
      if (!report) {
        setState({ kind: 'error', message: 'Report came back empty. Please try again.' })
        return
      }
      setState({ kind: 'report', text: report })
    } catch (e) {
      setState({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Network error fetching report',
      })
    }
  }, [inputAnalysis, outputAnalysis, macros, params, rainScore, genre, platform])

  const handleCopy = useCallback(() => {
    if (state.kind !== 'report') return
    void navigator.clipboard.writeText(state.text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [state])

  // Reset transient state when the dialog opens.
  const handleOpenChange = useCallback(
    (v: boolean) => {
      if (v) setState({ kind: 'idle' })
      onOpenChange(v)
    },
    [onOpenChange],
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-rain-accent" />
            Mastering Report
          </DialogTitle>
          <DialogDescription>
            LLM-generated analysis of your render against platform loudness and spectral targets.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto rain-scrollbar">
          {state.kind === 'idle' && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                Generate a markdown mastering report from the current render. The report covers
                loudness compliance, spectral balance, dynamic range, stereo image, and
                platform-specific recommendations.
              </p>
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                <Metric label="Input LUFS" value={inputAnalysis?.lufs.toFixed(1)} />
                <Metric label="Output LUFS" value={outputAnalysis?.lufs.toFixed(1)} />
                <Metric label="Output TruePeak" value={outputAnalysis?.truePeak.toFixed(1)} />
                <Metric label="Output DR" value={outputAnalysis?.dynamicRange.toFixed(1)} />
                <Metric label="RAIN Score" value={rainScore?.overall.toFixed(0)} />
                <Metric label="Genre" value={genre} />
              </div>
            </div>
          )}

          {state.kind === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-rain-accent" />
              Analyzing render...
            </div>
          )}

          {state.kind === 'report' && (
            <div className="rounded-md border border-rain-accent/20 bg-rain-surface-2 p-4">
              <div className="text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {state.text}
              </div>
            </div>
          )}

          {state.kind === 'upgrade' && (
            <UpgradePrompt required={state.required} current={state.current} />
          )}

          {state.kind === 'error' && (
            <div className="rounded-md border border-orange-500/30 bg-orange-500/10 p-4 text-sm text-orange-300">
              {state.message}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {state.kind === 'report' && (
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="w-3.5 h-3.5" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          )}
          {state.kind === 'error' && (
            <Button variant="outline" size="sm" onClick={() => setState({ kind: 'idle' })}>
              Back
            </Button>
          )}
          <Button
            onClick={generate}
            disabled={state.kind === 'loading' || !inputAnalysis || !outputAnalysis}
            size="sm"
          >
            {state.kind === 'loading' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
            {state.kind === 'report' ? 'Regenerate' : 'Generate Report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Metric({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="flex items-center justify-between rounded bg-rain-surface-2 px-2 py-1.5 border border-rain-border">
      <span className="text-muted-foreground uppercase">{label}</span>
      <span className="text-foreground font-bold tabular-nums">
        {value ?? '—'}
      </span>
    </div>
  )
}

function UpgradePrompt({ required, current }: { required: string; current: string }) {
  const requiredTier = PRICING_TIERS.find((t) => t.slug === required)
  return (
    <div className="space-y-4 py-2">
      <div className="flex items-start gap-3 rounded-md border border-rain-accent/30 bg-rain-accent/5 p-4">
        <Lock className="w-5 h-5 text-rain-accent flex-shrink-0 mt-0.5" />
        <div className="space-y-1.5">
          <div className="text-sm font-semibold text-foreground">
            {requiredTier ? requiredTier.name : required} tier required
          </div>
          <div className="text-xs text-muted-foreground">
            The standalone Mastering Report is an Independent-tier feature (≥ $29/mo). Your
            current tier is <span className="font-mono font-bold text-foreground">{current}</span>.
            Upgrade to unlock LLM-generated mastering reports, the Artist Identity Engine, and
            reference-track matching.
          </div>
          {requiredTier && (
            <div className="text-[11px] font-mono text-muted-foreground/80 pt-1">
              {requiredTier.name} · ${requiredTier.price}/{requiredTier.period} · {requiredTier.renders}
            </div>
          )}
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground/70 leading-relaxed">
        Note: in this sandbox no real auth flow is wired, so all callers are treated as Casual.
        To preview the report end-to-end, seed an Independent-tier Account row and send its id in
        the <code className="font-mono">x-user-id</code> request header.
      </div>
    </div>
  )
}

function serializeAnalysis(
  a: NonNullable<ReturnType<typeof useSessionStore.getState>['inputAnalysis']>,
  genre: string,
  platform: string,
) {
  return {
    lufs: a.lufs,
    truePeak: a.truePeak,
    rms: a.rms,
    dynamicRange: a.dynamicRange,
    bpm: a.bpm,
    key: a.key,
    genre,
    platform,
  }
}

function macrosToParams(macros: ReturnType<typeof useSessionStore.getState>['macros']) {
  // Fall back to the macro values if no ProcessingParams are computed yet.
  // The /api/rain/suggest route reads params?.macro_<key> for its prompt
  // summary, so we synthesize the minimal shape it expects.
  return {
    macro_brighten: macros.brighten,
    macro_glue: macros.glue,
    macro_width: macros.width,
    macro_punch: macros.punch,
    macro_warmth: macros.warmth,
    macro_space: macros.space,
    macro_repair: macros.repair,
  }
}

/**
 * In dev, the user can opt in by storing a user id in localStorage. We send
 * it as the `x-user-id` header. In production this would be replaced by the
 * NextAuth session token → server-side resolution.
 */
function getDevUserIdHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const id = window.localStorage.getItem('rain:user-id')
    if (id) return { 'x-user-id': id }
  } catch {
    // ignore — localStorage may be unavailable
  }
  return {}
}
