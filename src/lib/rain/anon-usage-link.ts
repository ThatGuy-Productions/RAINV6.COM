/**
 * Attach anonymous usage ledger rows to a newly registered account.
 *
 * Prevents a user from resetting the free allowance by signing up after
 * consuming free renders under an anonId. Events are also linked when possible.
 *
 * Does not merge two different accounts. Only rows with userId=null and the
 * matching anonId are updated.
 */

import { db } from '@/lib/db'

export async function attachAnonymousUsageToAccount(
  userId: string,
  anonId: string | null | undefined,
): Promise<{ usageUpdated: number; eventsUpdated: number }> {
  if (!userId || !anonId || anonId.length < 8) {
    return { usageUpdated: 0, eventsUpdated: 0 }
  }
  const safeAnon = anonId.slice(0, 128)

  const [usage, events] = await Promise.all([
    db.usageRecord.updateMany({
      where: { userId: null, anonId: safeAnon },
      data: { userId },
    }),
    db.event.updateMany({
      where: { userId: null, anonId: safeAnon },
      data: { userId },
    }),
  ])

  return { usageUpdated: usage.count, eventsUpdated: events.count }
}
