import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * GET /api/rain/admin/status
 *
 * Public (no-auth) probe used by the admin door UI to decide whether to
 * render the "Set up Enterprise admin" form (first run) or the "Login"
 * form (subsequent runs). Returns:
 *   { bootstrapped: boolean, accountCount: number, tierCounts: {...} }
 *
 * `bootstrapped` is true once any Enterprise-tier account exists. This is
 * a deliberately conservative gate: the one-time setup form is only shown
 * before the first enterprise admin exists.
 */
export async function GET(_req: NextRequest) {
  try {
    // SECURITY FIX (C2): Only return bootstrapped boolean publicly.
    // accountCount and tierCounts are information disclosure — they reveal
    // the total number of users and their tier distribution to anyone.
    const enterpriseCount = await db.account.count({
      where: { tier: 'enterprise' },
    })
    return NextResponse.json({
      bootstrapped: enterpriseCount > 0,
    })
  } catch (err) {
    console.error('[admin/status] failed:', err)
    return NextResponse.json(
      { bootstrapped: false },
      { status: 200 },
    )
  }
}
