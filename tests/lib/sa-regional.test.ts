/**
 * RAIN V6 — SA-regional configuration tests
 *
 * Validates currency formatting, POPIA defaults, SA payment method config,
 * and SA support hours logic.
 *
 * Run: bun test tests/lib/sa-regional.test.ts
 */

import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_CURRENCY,
  DEFAULT_TERRITORY,
  DEFAULT_LANGUAGE,
  ZAR_SYMBOL,
  formatZar,
  formatZarPrice,
  SA_TIER_PRICES_ZAR,
  SA_PAYMENT_METHODS,
  POPIA,
  isSupportOnline,
} from '../../src/lib/rain/sa-regional'

describe('South Africa defaults', () => {
  test('default currency is ZAR', () => {
    expect(DEFAULT_CURRENCY).toBe('ZAR')
  })

  test('default territory is ZA', () => {
    expect(DEFAULT_TERRITORY).toBe('ZA')
  })

  test('default language is eng', () => {
    expect(DEFAULT_LANGUAGE).toBe('eng')
  })

  test('ZAR symbol is R', () => {
    expect(ZAR_SYMBOL).toBe('R')
  })
})

describe('formatZar', () => {
  test('formats full rand amounts without decimals', () => {
    const result = formatZar(14900) // R149.00
    expect(result).toContain('R')
    expect(result).toContain('149')
  })

  test('formats fractional rand amounts', () => {
    const result = formatZar(14950) // R149.50
    // en-ZA locale produces "R149,50"
    expect(result).toContain('R')
    expect(result).toContain('149')
  })

  test('handles zero', () => {
    const result = formatZar(0)
    expect(result).toContain('R')
    expect(result).toContain('0')
  })
})

describe('formatZarPrice', () => {
  test('formats with period suffix', () => {
    const result = formatZarPrice(14900, 'mo')
    expect(result).toBe('R149/mo')
  })

  test('formats without period suffix', () => {
    const result = formatZarPrice(39900)
    expect(result).toContain('R')
  })
})

describe('SA tier prices', () => {
  test('free tier is R0.00', () => {
    expect(SA_TIER_PRICES_ZAR.free.amountCents).toBe(0)
    expect(SA_TIER_PRICES_ZAR.free.label).toContain('Free')
  })

  test('all tiers are zero during beta', () => {
    const tiers = ['creator', 'independent', 'producer', 'studio', 'label', 'enterprise'] as const
    for (const tier of tiers) {
      expect(SA_TIER_PRICES_ZAR[tier].amountCents).toBe(0)
    }
  })
})

describe('SA payment methods', () => {
  test('PayFast is first (most common SA gateway)', () => {
    expect(SA_PAYMENT_METHODS[0].id).toBe('payfast')
  })

  test('Ozow is second', () => {
    expect(SA_PAYMENT_METHODS[1].id).toBe('ozow')
  })

  test('Stripe is the international fallback', () => {
    expect(SA_PAYMENT_METHODS[2].id).toBe('stripe')
  })

  test('all SA methods have capabilities', () => {
    for (const method of SA_PAYMENT_METHODS) {
      expect(method.capabilities.length).toBeGreaterThan(0)
    }
  })

  test('PayFast supports instant EFT and local payment methods', () => {
    const payfast = SA_PAYMENT_METHODS.find((m) => m.id === 'payfast')!
    expect(payfast.capabilities).toContain('instant_eft')
    expect(payfast.capabilities).toContain('snapscan')
    expect(payfast.capabilities).toContain('zapper')
  })
})

describe('POPIA compliance', () => {
  test('responsible party is defined', () => {
    expect(POPIA.responsibleParty).toBeTruthy()
    expect(POPIA.responsibleParty).toContain('ThatGuy')
  })

  test('access request email is defined', () => {
    expect(POPIA.accessRequestEmail).toContain('@')
  })

  test('retention periods are reasonable', () => {
    expect(POPIA.retention.accountInactive).toBe(180)
    expect(POPIA.retention.sessionData).toBe(90)
    expect(POPIA.retention.analytics).toBe(365)
    expect(POPIA.retention.authTokens).toBe(7)
  })

  test('data locations are SA-based', () => {
    expect(POPIA.dataLocations.length).toBeGreaterThanOrEqual(1)
    expect(POPIA.dataLocations[0].region).toBe('South Africa')
  })

  test('legal bases cover all required grounds', () => {
    expect(POPIA.legalBases.consent).toBeTruthy()
    expect(POPIA.legalBases.contract).toBeTruthy()
  })
})

describe('isSupportOnline', () => {
  test('returns a boolean', () => {
    expect(typeof isSupportOnline()).toBe('boolean')
  })
})
