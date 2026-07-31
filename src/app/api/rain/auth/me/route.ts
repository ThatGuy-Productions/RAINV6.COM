import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/rain/auth'

export const runtime = 'nodejs'

/**
 * GET /api/rain/auth/me
 *
 * Resolve the currently authenticated user from the session cookie.
 * Returns `{ user: null }` when not logged in (200), or the public user
 * object when authenticated. Used by the client AuthContext to hydrate
 * identity on mount and after login/logout.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser(req)
    return NextResponse.json({ user })
  } catch (err) {
    console.error('[api/rain/auth/me] GET failed:', err)
    return NextResponse.json(
      { user: null, error: 'Failed to resolve session.' },
      { status: 500 },
    )
  }
}
