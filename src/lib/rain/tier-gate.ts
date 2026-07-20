/**
 * RAIN V6 — Pricing Tier Gate (Wave 3 P2-1 / P2-2)
 *
 * Server-side helper that resolves a user's pricing tier and enforces tier
 * requirements on API routes. Intended for use only inside Next.js route
 * handlers / server actions — it imports the Prisma client (`@/lib/db`).
 *
 * Identity model (Enterprise Admin Door):
 *   1. PRIMARY — the `rain_admin_session` cookie set by the real login flow
 *      in `auth.ts`. Resolved via `getSessionUser`. This is the canonical
 *      path: once an Enterprise admin logs in, every tier-gated feature
 *      unlocks transparently.
 *   2. FALLBACK — the legacy `x-user-id` request header (kept for API
 *      clients / scripted access). Absent header → anonymous Casual.
 *
 * Tier order (low → high):
 *   casual < creator < independent < producer < studio < label < enterprise
 */

import { NextRequest } from 'next/server'
import { PRICING_TIERS } from './constants'
import { db } from '@/lib/db'
import { getSessionUser } from './auth'

export type TierGateOk = { ok: true; tier: string; userId: string | null }
export type TierGateFail = {
  ok: false
  status: 403
  error: string
  required: string
  current: string
}
export type TierGateResult = TierGateOk | TierGateFail

/** Anonymous tier returned when no user identity is provided. */
export const ANONYMOUS_TIER = 'free'

/**
 * Resolve a user's tier.
 *
 * PRIMARY: the authenticated session (cookie). If a valid session exists,
 * its tier is authoritative — this is how the Enterprise admin door
 * unlocks every tier-gated route after login.
 *
 * FALLBACK: the `x-user-id` header (legacy / scripted). Looked up in the
 * Account table. Absent or unknown → anonymous Casual.
 *
 * Never throws: any DB / lookup failure degrades to Casual so routes
 * return a deterministic 403 rather than a 500.
 */
export async function getUserTier(req: NextRequest | null, userId?: string | null): Promise<string> {
  // 1. Authenticated session cookie — canonical path.
  const sessionUser = await getSessionUser(req)
  if (sessionUser) return sessionUser.tier

  // 2. Legacy x-user-id header fallback.
  let id = userId ?? null
  if (!id && req) {
    id = req.headers.get('x-user-id')
  }
  if (!id) return ANONYMOUS_TIER
  try {
    const account = await db.account.findUnique({
      where: { id },
      select: { tier: true },
    })
    if (!account) return ANONYMOUS_TIER
    return account.tier
  } catch (err) {
    console.error('[tier-gate] getUserTier lookup failed:', err)
    return ANONYMOUS_TIER
  }
}

/**
 * Convenience overload: read the tier straight from a userId string
 * (no request object). Used by server actions that already have the id.
 */
export async function getUserTierByUserId(userId: string | null): Promise<string> {
  return getUserTier(null, userId)
}

/**
 * Compare two tier slugs by their position in PRICING_TIERS.
 * Returns true if `userTier` is at least as high as `requiredTierSlug`.
 * Unknown slugs sort below casual.
 */
export function isTierSufficient(userTier: string, requiredTierSlug: string): boolean {
  const userRank = tierRank(userTier)
  const requiredRank = tierRank(requiredTierSlug)
  return userRank >= requiredRank
}

function tierRank(slug: string): number {
  const idx = PRICING_TIERS.findIndex((t) => t.slug === slug)
  // -1 (not found) → rank 0 (below casual). casual itself is rank 1.
  return idx < 0 ? 0 : idx + 1
}

/**
 * Combined helper: resolve the caller's tier and check it against the
 * required tier slug. Returns `{ ok: true, tier }` on success or
 * `{ ok: false, status: 403, error, required, current }` on failure.
 *
 * The 403 payload shape is intentionally stable so client code can render
 * an upgrade prompt: `{ error: 'Tier insufficient', required, current }`.
 */
export async function withTierGate(
  req: NextRequest | null,
  requiredTierSlug: string,
): Promise<TierGateResult> {
  // Prefer the authenticated session user — its id is authoritative when
  // the caller logged in through the Enterprise admin door.
  const sessionUser = await getSessionUser(req)
  if (sessionUser) {
    if (isTierSufficient(sessionUser.tier, requiredTierSlug)) {
      return { ok: true, tier: sessionUser.tier, userId: sessionUser.id }
    }
    return {
      ok: false,
      status: 403,
      error: 'Tier insufficient',
      required: requiredTierSlug,
      current: sessionUser.tier,
    }
  }
  // Legacy header fallback.
  const userId = req ? req.headers.get('x-user-id') : null
  const tier = await getUserTier(req, userId)
  if (isTierSufficient(tier, requiredTierSlug)) {
    return { ok: true, tier, userId }
  }
  return {
    ok: false,
    status: 403,
    error: 'Tier insufficient',
    required: requiredTierSlug,
    current: tier,
  }
}
