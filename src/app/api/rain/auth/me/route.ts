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
  const user = await getSessionUser(req)
  return NextResponse.json({ user })
}
