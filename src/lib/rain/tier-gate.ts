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
 * Tier precedence ladder (low → high), used for tier-rank comparisons.
 *
 * Decoupled from `PRICING_TIERS` (which drives the public pricing page and
 * intentionally lists only the free public-beta tier). The gate needs the
 * FULL ladder so `isTierSufficient('free', 'enterprise')` correctly returns
 * false — previously `enterprise` was absent from PRICING_TIERS, so
 * `tierRank('enterprise')` fell back to 0 and every enterprise-gated route
 * was effectively open to anonymous callers.
 *
 * Mirrors the ladder documented at the top of this file.
 */
const TIER_PRECEDENCE: readonly string[] = [
  'casual',
  'creator',
  'independent',
  'producer',
  'studio',
  'label',
  'enterprise',
] as const

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

  // SECURITY FIX (C3): The legacy x-user-id header fallback has been REMOVED.
  // It allowed any caller to impersonate any user by setting the x-user-id
  // header to a known CUID, bypassing the session cookie entirely.
  // Only the authenticated session cookie is trusted now.
  return ANONYMOUS_TIER
}

/**
 * Convenience overload: read the tier straight from a userId string
 * (no request object). Used by server actions that already have the id.
 */
export async function getUserTierByUserId(userId: string | null): Promise<string> {
  return getUserTier(null, userId)
}

/**
 * Compare two tier slugs by their position in the TIER_PRECEDENCE ladder.
 * Returns true if `userTier` is at least as high as `requiredTierSlug`.
 * Unknown slugs sort below casual.
 */
export function isTierSufficient(userTier: string, requiredTierSlug: string): boolean {
  // Exact match always satisfies (covers 'free'=='free' and unknown==unknown
  // where the caller explicitly passes the same slug).
  if (userTier === requiredTierSlug) return true
  const userRank = tierRank(userTier)
  const requiredRank = tierRank(requiredTierSlug)
  // If the required tier is unknown to the ladder (rank 0) and didn't exact-
  // match above, refuse — never let an unknown requirement be satisfied by
  // a different unknown/low tier.
  if (requiredRank === 0) return false
  return userRank >= requiredRank
}

function tierRank(slug: string): number {
  // 'free' (and any anonymous / unknown slug) ranks BELOW the paid ladder —
  // it cannot satisfy any tier requirement except itself.
  if (slug === ANONYMOUS_TIER) return 0
  const idx = TIER_PRECEDENCE.indexOf(slug)
  // Unknown slug (not in ladder, not 'free') → rank 0. Combined with the
  // exact-match short-circuit in isTierSufficient, this means an unknown
  // required tier is only satisfiable by an exact string match — never by
  // a lower tier accidentally comparing as >=.
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
  // SECURITY FIX (C3): x-user-id header fallback removed.
  // Only the session cookie is trusted for tier resolution.
  return {
    ok: false,
    status: 403,
    error: 'Tier insufficient',
    required: requiredTierSlug,
    current: ANONYMOUS_TIER,
  }
}
