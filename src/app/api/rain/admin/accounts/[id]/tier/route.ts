import { NextRequest, NextResponse } from 'next/server'
import { withTierGate } from '@/lib/rain/tier-gate'
import { setUserTier } from '@/lib/rain/auth'

export const runtime = 'nodejs'

/**
 * PATCH /api/rain/admin/accounts/[id]/tier
 *
 * Enterprise-only. Promote or demote an account to a new pricing tier.
 * Body: { tier: string } — must be a valid PRICING_TIERS slug.
 * Returns the updated public user object. Refuses 400 on an invalid slug
 * or 404 if the target account does not exist.
 *
 * This is the administrative lever: an Enterprise admin can grant any
 * tier to any account, which is how the door unlocks features for
 * non-enterprise users during demos / trials / support.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await withTierGate(req, 'enterprise')
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.error, required: gate.required, current: gate.current },
      { status: gate.status },
    )
  }
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'Missing account id' }, { status: 400 })

  let body: { tier?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const tier = typeof body.tier === 'string' ? body.tier : ''
  if (!tier) return NextResponse.json({ error: 'Missing tier' }, { status: 400 })

  const updated = await setUserTier(id, tier)
  if (!updated) {
    return NextResponse.json(
      { error: 'Invalid tier or account not found' },
      { status: 400 },
    )
  }
  return NextResponse.json({ user: updated, actor: { id: gate.userId, tier: gate.tier } })
}
