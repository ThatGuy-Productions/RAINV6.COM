import { NextRequest, NextResponse } from 'next/server'
import { withCsrf } from '@/lib/rain/csrf'

export const runtime = 'nodejs'
export const maxDuration = 20

/**
 * GET /api/rain/distribute/health
 *
 * Server-side LabelGrid connection check. Calls the documented GET /me
 * endpoint; never exposes the token to the client.
 */
export const GET = withCsrf(async (_req: NextRequest) => {
  const apiKey = process.env.LABELGRID_API_KEY
  const baseUrl = (process.env.LABELGRID_API_BASE_URL || 'https://api.labelgrid.com/api/public')
    .replace(/\/+$/, '')

  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      connected: false,
      status: 'missing_credentials',
      provider: 'LabelGrid',
      message: 'Set LABELGRID_API_KEY in the server environment to check the LabelGrid connection.',
    }, { status: 409 })
  }

  let url: URL
  try {
    url = new URL(baseUrl)
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
      throw new Error('HTTPS is required for the LabelGrid API base URL')
    }
  } catch {
    return NextResponse.json({
      ok: false,
      connected: false,
      status: 'invalid_configuration',
      provider: 'LabelGrid',
      message: 'LABELGRID_API_BASE_URL must be a valid HTTPS URL.',
    }, { status: 500 })
  }

  try {
    const response = await fetch(`${baseUrl}/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    })

    if (!response.ok) {
      // Avoid returning raw provider bodies, which can contain account details.
      return NextResponse.json({
        ok: false,
        connected: false,
        status: response.status === 401 || response.status === 403 ? 'authentication_failed' : 'provider_error',
        provider: 'LabelGrid',
        httpStatus: response.status,
        message: response.status === 401 || response.status === 403
          ? 'LabelGrid rejected the token or the account does not have API access enabled.'
          : `LabelGrid connection check returned HTTP ${response.status}.`,
      }, { status: 502 })
    }

    const account = await response.json().catch(() => null)
    return NextResponse.json({
      ok: true,
      connected: true,
      status: 'connected',
      provider: 'LabelGrid',
      environment: process.env.LABELGRID_ENV === 'sandbox' ? 'sandbox' : 'configured',
      account: account && typeof account === 'object'
        ? {
            id: typeof account.id === 'string' || typeof account.id === 'number' ? account.id : undefined,
            name: typeof account.name === 'string' ? account.name : undefined,
          }
        : undefined,
      message: 'LabelGrid API authentication succeeded. This check does not submit a release.',
    })
  } catch {
    return NextResponse.json({
      ok: false,
      connected: false,
      status: 'network_error',
      provider: 'LabelGrid',
      message: 'Could not reach LabelGrid. Check the configured base URL and server network access.',
    }, { status: 502 })
  }
})
