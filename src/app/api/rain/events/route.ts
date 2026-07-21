import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/rain/auth'
import { trackEvent, type EventType } from '@/lib/rain/server-analytics'

export const runtime = 'nodejs'

/**
 * POST /api/rain/events
 *
 * Client-fired event beacon for events with no natural server round-trip.
 * Server-side events (signup, login, render_completed, export_completed,
 * feedback_submitted) fire directly from their own route handlers instead
 * — fewer hops, and a browser console can't spoof them.
 *
 * Auth is optional on purpose: pre-signup funnel events (e.g. a future
 * landing-page CTA click) need to work anonymously via anonId. Once the
 * visitor signs up, the same anonId is passed to /auth/register and the
 * two can be joined later.
 *
 * Body: { type: 'tab_viewed' | 'referral_signup', anonId?: string, metadata?: object }
 */
const ALLOWED_CLIENT_TYPES: EventType[] = ['tab_viewed', 'referral_signup']

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type, anonId, metadata } = body as {
      type?: string
      anonId?: string
      metadata?: Record<string, unknown>
    }

    if (!type || !ALLOWED_CLIENT_TYPES.includes(type as EventType)) {
      // Reject anything not explicitly meant to be client-fired. This is
      // what keeps a browser console from injecting fake render_completed
      // rows into the beta's usage numbers.
      return NextResponse.json({ error: 'event type not allowed from client' }, { status: 400 })
    }

    const user = await getSessionUser(req).catch(() => null)

    await trackEvent({
      userId: user?.id ?? null,
      anonId: typeof anonId === 'string' ? anonId.slice(0, 128) : null,
      type: type as EventType,
      metadata,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/rain/events] failed:', err)
    // Analytics failures must never surface as user-facing errors.
    return NextResponse.json({ ok: true })
  }
}
