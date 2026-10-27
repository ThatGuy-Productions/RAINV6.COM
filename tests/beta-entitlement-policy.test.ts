import { describe, expect, test } from 'bun:test'
import {
  BETA_CREDITS_PER_RENDER,
  BETA_FREE_RENDER_ALLOWANCE,
  BETA_MONTHLY_CREDIT_ALLOWANCE,
  BETA_MONTHLY_EXPORT_LIMIT,
  BETA_UNLOCK_AMOUNT_CENTS,
  evaluateBetaEntitlement,
} from '../src/lib/rain/beta-entitlement-policy'

const free = (completedFreeRenders: number) => evaluateBetaEntitlement({
  completedFreeRenders,
  hasVerifiedR49Unlock: false,
  monthlyCreditsUsed: 0,
  successfulExportsThisMonth: 0,
})
const paid = (monthlyCreditsUsed: number, successfulExportsThisMonth: number) => evaluateBetaEntitlement({
  completedFreeRenders: 2,
  hasVerifiedR49Unlock: true,
  monthlyCreditsUsed,
  successfulExportsThisMonth,
})

describe('beta entitlement policy', () => {
  test('defines confirmed allowances', () => {
    expect(BETA_FREE_RENDER_ALLOWANCE).toBe(2)
    expect(BETA_MONTHLY_CREDIT_ALLOWANCE).toBe(1500)
    expect(BETA_CREDITS_PER_RENDER).toBe(25)
    expect(BETA_MONTHLY_EXPORT_LIMIT).toBe(30)
    expect(BETA_UNLOCK_AMOUNT_CENTS).toBe(4900)
  })

  test('allows two full-capability free renders, each with an included export', () => {
    expect(free(0)).toMatchObject({ canStartFullCapabilityRender: true, canExport: true, freeRendersRemaining: 2, reason: 'free-render' })
    expect(free(1)).toMatchObject({ canStartFullCapabilityRender: true, canExport: true, freeRendersRemaining: 1, reason: 'free-render' })
  })

  test('requires verified payment after two completed free renders', () => {
    expect(free(2)).toMatchObject({ canStartFullCapabilityRender: false, canExport: false, freeRendersRemaining: 0, reason: 'payment-required' })
  })

  test('paid beta permits renders within monthly credits and export cap', () => {
    expect(paid(250, 10)).toMatchObject({
      canStartFullCapabilityRender: true,
      canExport: true,
      monthlyCreditsRemaining: 1250,
      paidRendersRemainingByCredits: 50,
      monthlyExportsRemaining: 20,
      reason: 'paid-beta',
    })
  })

  test('blocks export number 31 even when 750 credits remain', () => {
    expect(paid(750, 30)).toMatchObject({
      canStartFullCapabilityRender: true,
      canExport: false,
      monthlyCreditsRemaining: 750,
      paidRendersRemainingByCredits: 30,
      monthlyExportsRemaining: 0,
      reason: 'monthly-export-limit',
    })
  })

  test('blocks rendering when fewer than 25 credits remain', () => {
    expect(paid(1490, 20)).toMatchObject({
      canStartFullCapabilityRender: false,
      canExport: true,
      monthlyCreditsRemaining: 10,
      paidRendersRemainingByCredits: 0,
      reason: 'monthly-credit-limit',
    })
  })

  test('normalizes invalid and negative counters safely', () => {
    expect(free(Number.NaN)).toMatchObject({ canStartFullCapabilityRender: true, canExport: true, freeRendersRemaining: 2 })
  })
})
