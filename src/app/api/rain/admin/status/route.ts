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
    const accounts = await db.account.findMany({
      select: { id: true, tier: true },
    })
    const tierCounts: Record<string, number> = {}
    for (const a of accounts) {
      tierCounts[a.tier] = (tierCounts[a.tier] ?? 0) + 1
    }
    return NextResponse.json({
      bootstrapped: (tierCounts.enterprise ?? 0) > 0,
      accountCount: accounts.length,
      tierCounts,
    })
  } catch (err) {
    console.error('[admin/status] failed:', err)
    return NextResponse.json(
      { bootstrapped: false, accountCount: 0, tierCounts: {}, error: 'Database unavailable' },
      { status: 200 },
    )
  }
}
