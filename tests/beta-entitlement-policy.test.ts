import { describe, expect, test } from 'bun:test'
import {
  BETA_FREE_USE_CREDITS,
  BETA_MONTHLY_EXPORT_LIMIT,
  BETA_UNLOCK_AMOUNT_CENTS,
  evaluateBetaEntitlement,
} from '../src/lib/rain/beta-entitlement-policy'

describe('beta entitlement policy', () => {
  test('grants full capability for each of the two unused free use credits', () => {
    expect(BETA_FREE_USE_CREDITS).toBe(2)
    expect(evaluateBetaEntitlement({
      completedFreeUseCredits: 0,
      hasVerifiedR49Unlock: false,
      successfulExportsThisMonth: 0,
    })).toMatchObject({ canStartFullCapabilityUse: true, canExport: true, freeUseCreditsRemaining: 2, reason: 'free-use-credit' })
    expect(evaluateBetaEntitlement({
      completedFreeUseCredits: 1,
      hasVerifiedR49Unlock: false,
      successfulExportsThisMonth: 0,
    })).toMatchObject({ canStartFullCapabilityUse: true, canExport: true, freeUseCreditsRemaining: 1, reason: 'free-use-credit' })
  })

  test('requires payment after both free use credits are consumed', () => {
    expect(evaluateBetaEntitlement({
      completedFreeUseCredits: 2,
      hasVerifiedR49Unlock: false,
      successfulExportsThisMonth: 0,
    })).toMatchObject({ canStartFullCapabilityUse: false, canExport: false, freeUseCreditsRemaining: 0, reason: 'payment-required' })
  })

  test('does not treat exports as free-use credits', () => {
    expect(evaluateBetaEntitlement({
      completedFreeUseCredits: 0,
      hasVerifiedR49Unlock: false,
      successfulExportsThisMonth: 30,
    })).toMatchObject({ canStartFullCapabilityUse: true, canExport: true, freeUseCreditsRemaining: 2 })
  })

  test('paid unlock restores full capability and allows up to 30 exports in the period', () => {
    expect(BETA_UNLOCK_AMOUNT_CENTS).toBe(4900)
    expect(BETA_MONTHLY_EXPORT_LIMIT).toBe(30)
    expect(evaluateBetaEntitlement({
      completedFreeUseCredits: 2,
      hasVerifiedR49Unlock: true,
      successfulExportsThisMonth: 29,
    })).toMatchObject({ canStartFullCapabilityUse: true, canExport: true, monthlyExportsRemaining: 1, reason: 'paid-beta' })
  })

  test('monthly export cap blocks export, not processing capability', () => {
    expect(evaluateBetaEntitlement({
      completedFreeUseCredits: 2,
      hasVerifiedR49Unlock: true,
      successfulExportsThisMonth: 30,
    })).toMatchObject({ canStartFullCapabilityUse: true, canExport: false, monthlyExportsRemaining: 0, reason: 'monthly-export-limit' })
  })

  test('normalizes invalid and negative counters safely', () => {
    expect(evaluateBetaEntitlement({
      completedFreeUseCredits: Number.NaN,
      hasVerifiedR49Unlock: false,
      successfulExportsThisMonth: -5,
    })).toMatchObject({ canStartFullCapabilityUse: true, canExport: true, freeUseCreditsRemaining: 2 })
  })
})
