import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { RAIN_ASSISTANT_SYSTEM_PROMPT } from '@/lib/rain/ai-prompts'
import { checkRateLimit } from '@/lib/rain/rate-limit'
// withTierGate is intentionally NOT imported — the AI Co-Master is unlocked
// for all users during the free public beta. Post-beta, re-add:
//   import { withTierGate } from '@/lib/rain/tier-gate'
// and gate with `withTierGate(req, 'creator')`.

export const runtime = 'nodejs'
export const maxDuration = 30

/** Abort the LLM call after 22s so our catch block can fire the graceful
 * fallback before the platform's 30s hard kill (which happens before the
 * catch block runs in production). */
const LLM_TIMEOUT_MS = 28_000
const LLM_MAX_TOKENS_ASSIST = 600

/**
 * POST /api/rain/assist
 *
 * AI Co-Master Engineer endpoint. Returns strictly-validated JSON with:
 *   - reply: conversational reply
 *   - suggestions: { macros, confidence, reasoning, tensions }
 *   - report: optional mastering report
 *
 * The LLM is instructed to respond with JSON only. We parse defensively and
 * fall back to a heuristic suggestion if parsing fails.
 *
 * BETA ACCESS POLICY: the AI Co-Master Engineer is available to all users
 * during the full-capability free beta. Do not require a paid-tier account or
 * trust an x-user-id header for product access. Rate limiting still applies.
 */
export async function POST(req: NextRequest) {
  try {
    // FREE BETA: the AI Co-Master Engineer is unlocked for everyone during the
    // free public beta (per the FAQ: "the AI Co-Master Engineer — all free").
    // The tier gate is intentionally NOT enforced here so anonymous + free-tier
    // users can use it. Post-beta, re-enable: `withTierGate(req, 'creator')`.
    // Rate limiting still applies to prevent LLM abuse.

    // Rate limit: 20 requests/min per IP — prevents abuse of the LLM endpoint.
    const rl = await checkRateLimit(req, 'assist', 20)
    if (!rl.ok) {
      return NextResponse.json(
        { error: rl.unavailable ? 'Rate limiting service unavailable' : 'Too many requests', retryAfter: rl.retryAfter },
        { status: rl.unavailable ? 503 : 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      )
    }

    const body = await req.json()
    const message = String(body.message ?? '').slice(0, 4000)
    const analysis = body.analysis ?? null
    const currentMacros = body.currentMacros ?? null

    if (!message || message.trim().length === 0) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 })
    }

    // Coerce all analysis fields to numbers defensively — the client may send
    // strings or objects, and `.toFixed(1)` only short-circuits null/undefined.
    const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
    const context = [
      analysis ? `Input analysis: LUFS=${num(analysis.lufs).toFixed(1)} dB, TruePeak=${num(analysis.truePeak).toFixed(1)} dBTP, RMS=${num(analysis.rms).toFixed(1)} dB, DR=${num(analysis.dynamicRange).toFixed(1)} LU${analysis.bpm ? `, BPM=${analysis.bpm}` : ''}${analysis.key ? `, Key=${analysis.key}` : ''}, Genre=${analysis.genre}, Target=${analysis.platform}.` : 'No audio analysis available yet.',
      currentMacros ? `Current macros: ${JSON.stringify(currentMacros)}` : 'No macros set yet (all default).',
    ].join(' ')

    const zai = await ZAI.create()
    const completion = await withTimeout(
      zai.chat.completions.create({
        messages: [
          // BUG FIX: was `role: 'assistant'` — the SDK forwards messages
          // verbatim, so the system prompt was treated as a prior assistant
          // turn, weakening instruction-following and inflating latency.
          { role: 'system', content: RAIN_ASSISTANT_SYSTEM_PROMPT },
          { role: 'user', content: `${context}\n\nUser request: ${message}` },
        ],
        thinking: { type: 'disabled' },
        max_tokens: LLM_MAX_TOKENS_ASSIST,
      }),
      LLM_TIMEOUT_MS,
    )

    // BUG FIX: stringify — content may arrive as an array of content blocks.
    const raw = String(completion.choices[0]?.message?.content ?? '')
    const parsed = safeParseResponse(raw)

    return NextResponse.json(parsed)
  } catch (err) {
    console.error('[RAIN assist] error:', err)
    return NextResponse.json({
      error: 'AI service unavailable',
      reply: 'I could not reach the AI service. Please try again.',
      suggestions: { macros: defaultMacros(), confidence: 0, reasoning: 'Service unavailable', tensions: [] },
    }, { status: 200 })
  }
}

function safeParseResponse(raw: string): {
  reply: string
  suggestions: { macros: Record<string, number>; confidence: number; reasoning: string; tensions: string[] }
  report?: string
} {
  // Strip markdown fences if present
  let cleaned = raw.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '')
  }
  // Find the first { ... } JSON block
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) {
    return {
      reply: raw.slice(0, 500),
      suggestions: { macros: defaultMacros(), confidence: 0, reasoning: 'Parse failed', tensions: [] },
    }
  }
  try {
    const json = JSON.parse(cleaned.slice(start, end + 1))
    const macros = clampMacros(json.suggestions?.macros ?? defaultMacros())
    return {
      reply: String(json.reply ?? '').slice(0, 1000),
      suggestions: {
        macros,
        confidence: clamp(Number(json.suggestions?.confidence ?? 0), 0, 100),
        reasoning: String(json.suggestions?.reasoning ?? '').slice(0, 1000),
        tensions: Array.isArray(json.suggestions?.tensions) ? json.suggestions.tensions.map(String).slice(0, 10) : [],
      },
      report: typeof json.report === 'string' ? json.report.slice(0, 4000) : undefined,
    }
  } catch {
    return {
      reply: raw.slice(0, 500),
      suggestions: { macros: defaultMacros(), confidence: 0, reasoning: 'Parse failed', tensions: [] },
    }
  }
}

function clampMacros(macros: Record<string, number>): Record<string, number> {
  const keys = ['brighten', 'glue', 'width', 'punch', 'warmth', 'space', 'repair']
  const out: Record<string, number> = {}
  for (const k of keys) {
    out[k] = clamp(Number(macros[k] ?? 5), 0, 10)
  }
  return out
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo
  return Math.max(lo, Math.min(hi, Math.round(n * 10) / 10))
}

function defaultMacros() {
  return { brighten: 5.0, glue: 5.0, width: 5.0, punch: 5.0, warmth: 5.0, space: 5.0, repair: 0.0 }
}

/** Race a promise against a timeout. Throws an Error on timeout so the
 * caller's try/catch can fire the graceful fallback. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('LLM request timed out')), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}
