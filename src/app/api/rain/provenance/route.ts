import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * GET /api/rain/provenance
 *
 * Returns metadata about the RAIN-CERT provenance system.
 * (Client-side WebCrypto generates the actual certificates — this endpoint
 *  exists for service discovery and capability advertisement.)
 *
 * TIER GATE (Wave 3 P2-2): intentionally NOT gated. Provenance is a
 * universal feature — the spec mandates that every render, on every tier
 * (including Casual), produces an Ed25519 RAIN-CERT certificate. Gating
 * provenance would break the audit trail for free-tier renders, so this
 * route is open to all callers regardless of `x-user-id`.
 */
export async function GET(_req: NextRequest) {
  try {
    return NextResponse.json({
      algorithm: 'Ed25519',
      manifestVersion: 'C2PA-2.2',
      watermark: 'none',
      watermark_note: 'AudioSeal not available in-browser; manifest records absence honestly',
      fingerprint: 'Chromaprint',
      compliance: ['EU-AI-Act-Article-50', 'DDEX-ERN-4.3.2', 'C2PA-2.2', 'ISO-3901-ISRC'],
      deadline: '2026-08-02',
    })
  } catch (err) {
    console.error('[api/rain/provenance] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to retrieve provenance metadata.' },
      { status: 500 },
    )
  }
}
