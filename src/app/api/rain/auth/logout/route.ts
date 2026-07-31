import { NextRequest, NextResponse } from 'next/server'
import { logout } from '@/lib/rain/auth'

export const runtime = 'nodejs'

/**
 * POST /api/rain/auth/logout
 *
 * Invalidate the current session token (deletes the AuthToken row so it
 * cannot be replayed) and clear the client cookie. Always returns 200
 * — calling logout when not logged in is a no-op, not an error.
 */
export async function POST(req: NextRequest) {
  try {
    const setCookie = await logout(req)
    const res = NextResponse.json({ ok: true })
    res.headers.set('Set-Cookie', setCookie)
    return res
  } catch (err) {
    console.error('[api/rain/auth/logout] POST failed:', err)
    return NextResponse.json(
      { ok: false, error: 'Logout failed. Please try again.' },
      { status: 500 },
    )
  }
}
