import { NextResponse } from 'next/server'

/**
 * This legacy endpoint accepted metadata and a package hash without receiving
 * the package bytes, so it could not independently verify the actual ZIP.
 * It is intentionally disabled. Use POST /api/rain/distribute with the
 * complete multipart ZIP package; that route verifies the bytes and checksums.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      delivery: { status: 'failed' },
      error: 'This legacy endpoint is disabled because it cannot verify package bytes. Submit the complete ZIP to /api/rain/distribute instead.',
    },
    { status: 410 },
  )
}
