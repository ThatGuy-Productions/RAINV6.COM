import { getAnonId } from '@/lib/rain/anon-id'

/**
 * Client-side advisory preflight for the beta entitlement policy.
 *
 * The server (/api/rain/beta-access) is authoritative. This helper only
 * surfaces the decision for UI gating. Local storage is a conservative
 * fallback when the network call fails — it is not a security boundary
 * because encoding remains in the browser.
 */

const LOCAL_EXPORT_COUNT_KEY = 'rain_beta_successful_exports_v1'

export interface BetaAccessClientView {
  allowed: boolean
  canStartFullCapabilityRender: boolean
  canExport: boolean
  freeRendersRemaining: number
  reason: string
  unlockRequired: boolean
  exportsUsed: number
  checkoutAvailable: boolean
  paymentStatus: string
}

function getLocalExportCount(): number {
  try {
    const value = Number(window.localStorage.getItem(LOCAL_EXPORT_COUNT_KEY) ?? '0')
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  } catch {
    return 0
  }
}

/** UX preflight. Prefer the server decision; fall back conservatively. */
export async function checkBetaExportAllowance(): Promise<BetaAccessClientView> {
  const response = await fetch(
    `/api/rain/beta-access?anonId=${encodeURIComponent(getAnonId() ?? '')}`,
    { cache: 'no-store' },
  )
  if (!response.ok) throw new Error('Could not verify the beta entitlement.')

  const result = await response.json() as {
    canStartFullCapabilityRender?: boolean
    canExport?: boolean
    freeRendersRemaining?: number
    reason?: string
    unlockRequired?: boolean
    exportsUsed?: number
    checkoutAvailable?: boolean
    paymentStatus?: string
  }

  const canExport = result.canExport === true
  const canRender = result.canStartFullCapabilityRender === true
  const serverExports = typeof result.exportsUsed === 'number' ? result.exportsUsed : 0
  const localExports = getLocalExportCount()
  // If the server is reachable, trust it. Local count is only a tie-break
  // when the server omits the field (should not happen after wiring).
  const exportsUsed = Math.max(serverExports, localExports)

  return {
    allowed: canExport,
    canStartFullCapabilityRender: canRender,
    canExport,
    freeRendersRemaining: typeof result.freeRendersRemaining === 'number'
      ? result.freeRendersRemaining
      : 0,
    reason: typeof result.reason === 'string' ? result.reason : 'unknown',
    unlockRequired: result.unlockRequired === true || result.reason === 'payment-required',
    exportsUsed,
    checkoutAvailable: result.checkoutAvailable === true,
    paymentStatus: typeof result.paymentStatus === 'string' ? result.paymentStatus : 'not_live',
  }
}

/** Remember a completed browser export even if the analytics request failed. */
export function recordLocalBetaExport(): void {
  try {
    window.localStorage.setItem(LOCAL_EXPORT_COUNT_KEY, String(getLocalExportCount() + 1))
  } catch {
    // Durable server-side events remain the source of truth when available.
  }
}
