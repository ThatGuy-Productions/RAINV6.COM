import { describe, expect, it } from 'bun:test'
import { resolveBetaExportAllowance } from '../../src/lib/rain/beta-export-quota'

describe('legacy client-side export gate (not the confirmed product policy)', () => {
  it('allows the first and second exports', () => {
    expect(resolveBetaExportAllowance(0, 0, false)).toEqual({ allowed: true, exportsUsed: 0 })
    expect(resolveBetaExportAllowance(1, 1, false)).toEqual({ allowed: true, exportsUsed: 1 })
  })

  it('requires the R49 unlock after two successful exports', () => {
    expect(resolveBetaExportAllowance(2, 2, true)).toEqual({ allowed: false, exportsUsed: 2 })
  })

  it('uses the higher server or local count so a failed telemetry write does not reset the browser allowance', () => {
    expect(resolveBetaExportAllowance(1, 2, false)).toEqual({ allowed: false, exportsUsed: 2 })
    expect(resolveBetaExportAllowance(2, 0, false)).toEqual({ allowed: false, exportsUsed: 2 })
  })

  it('normalizes invalid or negative counts safely', () => {
    expect(resolveBetaExportAllowance(Number.NaN, -3, false)).toEqual({ allowed: true, exportsUsed: 0 })
  })
})
