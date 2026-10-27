import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/rain/auth'
import { trackEvent } from '@/lib/rain/server-analytics'
import { withCsrf } from '@/lib/rain/csrf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_PROJECT_JSON_CHARS = 256_000

function parseProjectJson(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value === 'string') {
    if (value.length > MAX_PROJECT_JSON_CHARS) return undefined
    try {
      JSON.parse(value)
      return value
    } catch {
      return undefined
    }
  }
  try {
    const serialized = JSON.stringify(value)
    if (serialized.length > MAX_PROJECT_JSON_CHARS) return undefined
    return serialized
  } catch {
    return undefined
  }
}

/**
 * GET /api/rain/session
 * Lists the signed-in user's most recent projects, or returns one project
 * when ?id=... is supplied. The uploaded audio itself is never stored here:
 * this endpoint persists project metadata/settings only.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req).catch(() => null)
  if (!user) return NextResponse.json({ error: 'Sign in to access saved projects.' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  try {
    if (id) {
      const project = await db.session.findFirst({
        where: { id, userId: user.id },
        select: {
          id: true, name: true, inputFileHash: true, inputMetadata: true,
          renderSettings: true, status: true, createdAt: true, updatedAt: true,
        },
      })
      if (!project) return NextResponse.json({ error: 'Saved project not found.' }, { status: 404 })
      return NextResponse.json({ project })
    }

    const projects = await db.session.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true, name: true, inputFileHash: true, inputMetadata: true,
        renderSettings: true, status: true, createdAt: true, updatedAt: true,
      },
    })
    return NextResponse.json({ projects })
  } catch (error) {
    console.error('[api/rain/session] list failed:', error)
    return NextResponse.json({ error: 'Saved projects are temporarily unavailable.' }, { status: 503 })
  }
}

/**
 * POST /api/rain/session
 * Creates a durable project row for a signed-in user. Anonymous visitors can
 * use the full beta, but their projects cannot be attached to an account
 * until they sign in; only an anonymous funnel event is recorded.
 */
export const POST = withCsrf(async (req: NextRequest) => {
  const user = await getSessionUser(req).catch(() => null)
  let body: { name?: unknown; fileName?: unknown; anonId?: unknown; inputMetadata?: unknown; renderSettings?: unknown; inputFileHash?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 200)
      : typeof body.fileName === 'string'
        ? body.fileName.slice(0, 200)
        : 'Untitled'
  const anonId = typeof body.anonId === 'string' && body.anonId.length > 0 ? body.anonId.slice(0, 128) : null
  const inputMetadata = parseProjectJson(body.inputMetadata)
  const renderSettings = parseProjectJson(body.renderSettings)
  const inputFileHash = typeof body.inputFileHash === 'string' ? body.inputFileHash : null

  if (inputMetadata === undefined || renderSettings === undefined) {
    return NextResponse.json({ error: 'Project metadata/settings must be valid JSON and no larger than 256 KB each.' }, { status: 400 })
  }
  if (inputFileHash && !/^[a-f0-9]{64}$/i.test(inputFileHash)) {
    return NextResponse.json({ error: 'inputFileHash must be a SHA-256 hex digest.' }, { status: 400 })
  }

  if (!user) {
    const telemetryRecorded = await trackEvent({
      userId: null, anonId, type: 'session_created',
      metadata: { name, anonymous: true },
    })
    return NextResponse.json({ sessionId: null, anonymous: true, telemetryRecorded }, { status: 200 })
  }

  try {
    const project = await db.session.create({
      data: {
        userId: user.id, name, status: 'draft',
        inputMetadata: inputMetadata ?? null,
        renderSettings: renderSettings ?? null,
        inputFileHash,
      },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    })
    const telemetryRecorded = await trackEvent({
      userId: user.id, anonId, type: 'session_created',
      metadata: { sessionId: project.id },
    })
    return NextResponse.json({ sessionId: project.id, project, anonymous: false, telemetryRecorded }, { status: 201 })
  } catch (error) {
    console.error('[api/rain/session] create failed:', error)
    return NextResponse.json({ error: 'Could not save project. Check persistent database configuration.' }, { status: 503 })
  }
})

/** PUT /api/rain/session — autosave project state, scoped to its owner. */
export const PUT = withCsrf(async (req: NextRequest) => {
  const user = await getSessionUser(req).catch(() => null)
  if (!user) return NextResponse.json({ error: 'Sign in to save projects across sessions.' }, { status: 401 })

  let body: { sessionId?: unknown; name?: unknown; inputMetadata?: unknown; renderSettings?: unknown; inputFileHash?: unknown; status?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 })

  const inputMetadata = parseProjectJson(body.inputMetadata)
  const renderSettings = parseProjectJson(body.renderSettings)
  if (inputMetadata === undefined || renderSettings === undefined) {
    return NextResponse.json({ error: 'Project metadata/settings must be valid JSON and no larger than 256 KB each.' }, { status: 400 })
  }
  const inputFileHash = body.inputFileHash === undefined
    ? undefined
    : body.inputFileHash === null || body.inputFileHash === ''
      ? null
      : typeof body.inputFileHash === 'string' && /^[a-f0-9]{64}$/i.test(body.inputFileHash)
        ? body.inputFileHash
        : undefined
  if (body.inputFileHash !== undefined && inputFileHash === undefined) {
    return NextResponse.json({ error: 'inputFileHash must be a SHA-256 hex digest.' }, { status: 400 })
  }

  const status = typeof body.status === 'string' && ['draft', 'inferring', 'rendered', 'archived'].includes(body.status)
    ? body.status
    : undefined
  const data: Record<string, unknown> = {}
  if (typeof body.name === 'string') data.name = body.name.trim().slice(0, 200) || 'Untitled'
  if (inputMetadata !== undefined) data.inputMetadata = inputMetadata
  if (renderSettings !== undefined) data.renderSettings = renderSettings
  if (body.inputFileHash !== undefined) data.inputFileHash = inputFileHash
  if (status) data.status = status

  try {
    const result = await db.session.updateMany({ where: { id: sessionId, userId: user.id }, data })
    if (result.count === 0) return NextResponse.json({ error: 'Saved project not found.' }, { status: 404 })
    return NextResponse.json({ ok: true, savedAt: new Date().toISOString() })
  } catch (error) {
    console.error('[api/rain/session] save failed:', error)
    return NextResponse.json({ error: 'Could not save project. Check persistent database configuration.' }, { status: 503 })
  }
})
