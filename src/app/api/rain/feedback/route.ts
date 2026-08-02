import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/rain/auth'
import { trackEvent } from '@/lib/rain/server-analytics'
import { withCsrf } from '@/lib/rain/csrf'

export const runtime = 'nodejs'

/**
 * POST /api/rain/feedback
 *
 * Collects user feedback for the free beta. Stores in the Feedback table.
 * No authentication required — we want feedback from everyone.
 *
 * Body: { comment: string, email?: string, allowFollowUp?: boolean }
 */
export const POST = withCsrf(async (req: NextRequest) => {
  let body: { comment?: unknown; email?: unknown; allowFollowUp?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const comment = typeof body.comment === 'string' ? body.comment.trim() : ''
  if (!comment || comment.length < 3) {
    return NextResponse.json({ error: 'Please provide at least a short comment' }, { status: 400 })
  }
  if (comment.length > 2000) {
    return NextResponse.json({ error: 'Comment too long — 2000 characters max' }, { status: 400 })
  }

  try {
    await db.feedback.create({
      data: {
        comment: comment.slice(0, 2000),
        email: typeof body.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : null,
        allowFollowUp: body.allowFollowUp === true,
        userAgent: req.headers.get('user-agent')?.slice(0, 255) ?? null,
      },
    })

    // No auth required to submit feedback, but attribute the event to an
    // account when the caller happens to be logged in — useful for the
    // feature-depth / retention correlation later, doesn't gate anything.
    const user = await getSessionUser(req).catch(() => null)
    void trackEvent({ userId: user?.id, type: 'feedback_submitted' })

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    console.error('[feedback] create failed:', err)
    return NextResponse.json({ error: 'Feedback service unavailable' }, { status: 500 })
  }
})
