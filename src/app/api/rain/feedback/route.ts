import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/rain/auth'
import { apiSuccess, apiError, withErrorHandler, logApiRequest } from '@/lib/rain/api-utils'
import { sanitizeFeedback } from '@/lib/rain/sanitize'
import { trackEvent } from '@/lib/rain/server-analytics'

export const runtime = 'nodejs'

/**
 * POST /api/rain/feedback
 *
 * Collects user feedback for the free beta. Stores in the Feedback table.
 * No authentication required — we want feedback from everyone.
 *
 * Body: { comment: string, email?: string, allowFollowUp?: boolean }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const start = Date.now()

  let body: { comment?: unknown; email?: unknown; allowFollowUp?: unknown }
  try {
    body = await req.json()
  } catch {
    logApiRequest('POST', '/api/rain/feedback', 400, Date.now() - start)
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const comment = typeof body.comment === 'string' ? body.comment.trim() : ''
  if (!comment || comment.length < 3) {
    logApiRequest('POST', '/api/rain/feedback', 400, Date.now() - start)
    return NextResponse.json({ error: 'Please provide at least a short comment' }, { status: 400 })
  }
  if (comment.length > 2000) {
    logApiRequest('POST', '/api/rain/feedback', 400, Date.now() - start)
    return NextResponse.json({ error: 'Comment too long — 2000 characters max' }, { status: 400 })
  }

  // Phase 5 — sanitize user-submitted content
  const sanitized = sanitizeFeedback(comment)
  if (sanitized.rejected) {
    logApiRequest('POST', '/api/rain/feedback', 422, Date.now() - start)
    return NextResponse.json({ error: sanitized.reason ?? 'Input contains potentially dangerous content' }, { status: 422 })
  }

  try {
    await db.feedback.create({
      data: {
        comment: sanitized.sanitized.slice(0, 2000),
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

    logApiRequest('POST', '/api/rain/feedback', 201, Date.now() - start)
    return apiSuccess({ ok: true }, 201)
  } catch (err) {
    console.error('[feedback] create failed:', err)
    logApiRequest('POST', '/api/rain/feedback', 500, Date.now() - start)
    return apiError('Feedback service unavailable', 500, 'db_write')
  }
})
