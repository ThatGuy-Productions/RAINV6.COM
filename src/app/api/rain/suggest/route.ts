import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { RAIN_ASSISTANT_REPORT_PROMPT } from '@/lib/rain/ai-prompts'
import { checkRateLimit } from '@/lib/rain/rate-limit'
import { withTierGate } from '@/lib/rain/tier-gate'

export const runtime = 'nodejs'
export const maxDuration = 30

const LLM_TIMEOUT_MS = 22_000
const LLM_MAX_TOKENS_SUGGEST = 500

/**
 * POST /api/rain/suggest
 *
 * Generate a markdown mastering report based on input/output analysis.
 *
 * TIER GATE (Wave 3 P2-2): requires `independent` tier. The standalone
 * mastering report (deeper than the inline `report` field returned by
 * /api/rain/assist) is an Independent-tier feature (≥ $29/mo). Identity
 * is read from the optional `x-user-id` request header; absent header is
 * treated as Casual. Returns HTTP 403 with `{ error, required, current }`
 * when the caller's tier is below Independent. The MasteringTab "Generate
 * Mastering Report" button handles the 403 by showing an upgrade dialog.
 */
export async function POST(req: NextRequest) {
  try {
    // Tier gate: standalone mastering report is an Independent-tier feature.
    const gate = await withTierGate(req, 'independent')
    if (!gate.ok) {
      return NextResponse.json(
        { error: gate.error, required: gate.required, current: gate.current },
        { status: gate.status },
      )
    }

    // Rate limit: 15 requests/min per IP — slightly tighter than assist since
    // report generation is more expensive.
    const rl = checkRateLimit(req, 'suggest', 15)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      )
    }

    const body = await req.json()
    const input = body.input
    const output = body.output
    const params = body.params
    const score = body.score

    if (!input || !output) {
      return NextResponse.json({ error: 'input and output analysis required' }, { status: 400 })
    }

    // Coerce to numbers defensively — .toFixed(1) throws on non-numbers.
    const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
    const summary = [
      `Input: LUFS=${num(input.lufs).toFixed(1)} dB, TruePeak=${num(input.truePeak).toFixed(1)} dBTP, RMS=${num(input.rms).toFixed(1)} dB, DR=${num(input.dynamicRange).toFixed(1)} LU, BPM=${input.bpm ?? 'n/a'}, Key=${input.key ?? 'n/a'}, Genre=${input.genre}, Target=${input.platform}.`,
      `Output: LUFS=${num(output.lufs).toFixed(1)} dB, TruePeak=${num(output.truePeak).toFixed(1)} dBTP, RMS=${num(output.rms).toFixed(1)} dB, DR=${num(output.dynamicRange).toFixed(1)} LU.`,
      `Macros applied: BRIGHTEN=${params?.macro_brighten ?? 5}, GLUE=${params?.macro_glue ?? 5}, WIDTH=${params?.macro_width ?? 5}, PUNCH=${params?.macro_punch ?? 5}, WARMTH=${params?.macro_warmth ?? 5}, SPACE=${params?.macro_space ?? 5}, REPAIR=${params?.macro_repair ?? 0}.`,
      `RAIN Score: overall=${score?.overall ?? 'n/a'}, spotify=${score?.spotify ?? 'n/a'}, apple=${score?.apple_music ?? 'n/a'}, youtube=${score?.youtube ?? 'n/a'}, tidal=${score?.tidal ?? 'n/a'}.`,
    ].join('\n')

    const zai = await ZAI.create()
    const completion = await withTimeout(
      zai.chat.completions.create({
        messages: [
          // BUG FIX: was `role: 'assistant'` — should be 'system'.
          { role: 'system', content: RAIN_ASSISTANT_REPORT_PROMPT },
          { role: 'user', content: summary },
        ],
        thinking: { type: 'disabled' },
        max_tokens: LLM_MAX_TOKENS_SUGGEST,
      }),
      LLM_TIMEOUT_MS,
    )

    const report = String(completion.choices[0]?.message?.content ?? '').trim()
    return NextResponse.json({ report })
  } catch (err) {
    console.error('[RAIN suggest] error:', err)
    return NextResponse.json({
      report: '## Mastering Report\n\nThe AI report service is currently unavailable. Please review the metrics panel for the latest analysis.',
    }, { status: 200 })
  }
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
