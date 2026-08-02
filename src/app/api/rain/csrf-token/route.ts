import { NextRequest, NextResponse } from 'next/server'
import { generateCsrfToken, setCsrfCookieReadable, CSRF_COOKIE } from '@/lib/rain/csrf'

export const runtime = 'nodejs'

/**
 * GET /api/rain/csrf-token
 *
 * Issues a CSRF token for the current session. The token is returned in
 * TWO places:
 *   1. The Set-Cookie header (so the browser sends it back on subsequent
 *      requests — this is the server's reference copy)
 *   2. The JSON response body (so JavaScript can read it and attach it
 *      as the X-CSRF-Token header)
 *
 * The cookie is deliberately NOT httpOnly so the client can confirm the
 * token was set. This is safe because CSRF protection relies on the
 * attacker's inability to set the X-CSRF-Token custom header in a
 * cross-origin request, not on cookie secrecy.
 *
 * Call this once on app startup / page load, then attach the token to
 * all state-changing fetch requests.
 *
 * Response:
 *   {
 *     token: "<base64url-encoded 32-byte token>",
 *     header: "X-CSRF-Token",
 *     cookie: "__Host-rain-csrf"
 *   }
 */
export async function GET(_req: NextRequest) {
  const token = generateCsrfToken()

  const response = NextResponse.json({
    token,
    header: 'X-CSRF-Token',
    cookie: CSRF_COOKIE,
  })

  setCsrfCookieReadable(response, token)
  return response
}
