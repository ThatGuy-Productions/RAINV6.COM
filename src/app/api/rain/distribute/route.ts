import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
// Forwarding a multi-MB ZIP can take a while against the provider; allow up to
// 60 s. The Edge runtime has a 30 s ceiling for some providers, so we stay on
// Node.
export const maxDuration = 60

/**
 * POST /api/rain/distribute
 *
 * Real DSP aggregator delivery integration.
 *
 * Body (multipart/form-data):
 *   - `jobId`      — DeliveryJob id (string)
 *   - `manifest`   — JSON-stringified ReleaseManifest
 *   - `package`    — the ZIP Blob (application/zip) containing ern.xml +
 *                    manifest.json + checksums.txt + assets/ + artwork/
 *
 * Server-side credentials (read from process.env — never exposed to the
 * browser):
 *   - `LABELGRID_API_KEY` — bearer token for the LabelGrid REST API.
 *   - `LABELGRID_API_URL` — base URL (optional; defaults to
 *                            https://api.labelgrid.com/v1/deliveries).
 *
 * Behaviour:
 *   • If `LABELGRID_API_KEY` is missing → HTTP 409 with
 *     `{ ok: false, requiresCredentials: true, error: '...' }`. The package
 *     IS built and IS ready for delivery; the operator just hasn't supplied
 *     credentials yet. This is the honest path — the route never reports
 *     success unless the provider returned 2xx.
 *   • If present → forward the multipart body to LabelGrid with
 *     `Authorization: Bearer <key>`. 2xx → 200 with provider response body.
 *     Non-2xx → 502 with the provider's error message.
 *
 * Honesty note: LabelGrid's public API contract is not standardised in the
 * spec; the integration uses the conventional REST shape
 * (`POST /v1/deliveries` with a multipart upload + Bearer auth). If
 * LabelGrid changes their endpoint shape, set `LABELGRID_API_URL` to the new
 * endpoint and the integration will follow without code changes.
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.LABELGRID_API_KEY
  const apiUrl = process.env.LABELGRID_API_URL || 'https://api.labelgrid.com/v1/deliveries'

  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        requiresCredentials: true,
        error:
          'LABELGRID_API_KEY env var not set — package is built but not submitted. ' +
          'Set the env var (and optionally LABELGRID_API_URL) in .env and restart the dev ' +
          'server to enable real delivery.',
      },
      { status: 409 },
    )
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        requiresCredentials: false,
        error: `Invalid multipart body: ${e instanceof Error ? e.message : 'parse error'}`,
      },
      { status: 400 },
    )
  }

  const jobId = form.get('jobId')
  const manifest = form.get('manifest')
  const pkg = form.get('package')
  if (typeof jobId !== 'string' || typeof manifest !== 'string' || !(pkg instanceof Blob)) {
    return NextResponse.json(
      {
        ok: false,
        requiresCredentials: false,
        error: 'Missing required multipart fields (jobId, manifest, package)',
      },
      { status: 400 },
    )
  }

  // Forward the multipart payload to the provider. We rebuild the FormData
  // because the incoming Blob may have been consumed by the Next.js body
  // parser; rebuilding also lets us normalise the filename.
  const outForm = new FormData()
  outForm.append('jobId', jobId)
  outForm.append('manifest', manifest)
  outForm.append('package', pkg, `${jobId}.zip`)

  try {
    const providerResp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: outForm,
      // 50 s ceiling — leaves headroom under the route's 60 s maxDuration.
      signal: AbortSignal.timeout(50_000),
    })

    const respText = await providerResp.text()
    if (providerResp.ok) {
      return NextResponse.json({
        ok: true,
        providerResponse: respText.slice(0, 4096) || `HTTP ${providerResp.status}`,
      })
    }
    return NextResponse.json(
      {
        ok: false,
        requiresCredentials: false,
        error: `LabelGrid returned HTTP ${providerResp.status}: ${respText.slice(0, 1024)}`,
        providerResponse: respText.slice(0, 4096),
      },
      { status: 502 },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Network error during provider fetch'
    return NextResponse.json(
      {
        ok: false,
        requiresCredentials: false,
        error: `Delivery request failed: ${msg}`,
      },
      { status: 502 },
    )
  }
}
