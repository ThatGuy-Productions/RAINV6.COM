import { NextRequest, NextResponse } from 'next/server'
import { getSessionUserWithRotation } from '@/lib/rain/auth'

export const runtime = 'nodejs'

/**
 * GET /api/rain/auth/me
 *
 * Resolve the currently authenticated user from the session cookie.
 * Returns `{ user: null }` when not logged in (200), or the public user
 * object when authenticated. Used by the client AuthContext to hydrate
 * identity on mount and after login/logout.
 *
 * Also handles session rotation: if the session token is >7 days old,
 * a new token is minted and returned via Set-Cookie header.
 */
export async function GET(req: NextRequest) {
  try {
    const { user, rotatedCookie } = await getSessionUserWithRotation(req)
    const res = NextResponse.json({ user })
    if (rotatedCookie) {
      res.headers.set('Set-Cookie', rotatedCookie)
    }
    return res
  } catch (err) {
    console.error('[auth/me] Error:', err)
    return NextResponse.json(
      { user: null, error: 'Authentication service unavailable' },
      { status: 500 },
    )
  }
}
