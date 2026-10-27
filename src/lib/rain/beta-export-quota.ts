import { getAnonId } from '@/lib/rain/anon-id'

const LOCAL_EXPORT_COUNT_KEY = 'rain_beta_successful_exports_v1'
const FREE_EXPORT_LIMIT = 2

function getLocalExportCount(): number {
  try {
    const value = Number(window.localStorage.getItem(LOCAL_EXPORT_COUNT_KEY) ?? '0')
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  } catch {
    return 0
  }
}

/** UX preflight for the two-export beta allowance. The server count is durable;
 * the local count is a conservative fallback if an export event write fails.
 * This is not a security boundary because the actual encoder is browser-side. */
export async function checkBetaExportAllowance(): Promise<{ allowed: boolean; exportsUsed: number }> {
  const response = await fetch(`/api/rain/beta-access?anonId=${encodeURIComponent(getAnonId() ?? '')}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('Could not verify the beta export allowance.')
  const result = await response.json() as { exportsUsed?: number; unlockRequired?: boolean }
  const serverCount = typeof result.exportsUsed === 'number' ? Math.max(0, result.exportsUsed) : 0
  const exportsUsed = Math.max(serverCount, getLocalExportCount())
  return { allowed: !result.unlockRequired && exportsUsed < FREE_EXPORT_LIMIT, exportsUsed }
}

/** Remember a completed browser export even if the analytics request failed. */
export function recordLocalBetaExport(): void {
  try {
    window.localStorage.setItem(LOCAL_EXPORT_COUNT_KEY, String(getLocalExportCount() + 1))
  } catch {
    // Durable server-side events remain the source of truth when available.
  }
}
