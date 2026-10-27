import { afterAll, describe, expect, it } from 'bun:test'
import { PrismaClient } from '@prisma/client'
import { db } from '../../src/lib/db'
import { loginWithPassword, registerUser } from '../../src/lib/rain/auth'

const enabled = process.env.RUN_DB_INTEGRATION_TESTS === '1'
const verifier = enabled ? new PrismaClient() : null

describe.skipIf(!enabled)('persistent account and project storage (PostgreSQL integration)', () => {
  afterAll(async () => {
    await verifier?.$disconnect()
  })

  it('keeps account, login token, saved project metadata, and usage events visible to a separate DB connection', async () => {
    const suffix = crypto.randomUUID()
    const email = `persistence-${suffix}@example.test`
    const password = 'test-only-password-123'
    let userId: string | undefined

    try {
      const registration = await registerUser(email, password, 'Persistence acceptance test')
      expect(registration.ok).toBe(true)
      if (!registration.ok) throw new Error(registration.error)
      userId = registration.user.id

      const login = await loginWithPassword(email, password)
      expect(login.ok).toBe(true)
      if (!login.ok) throw new Error(login.error)

      const project = await db.session.create({
        data: {
          userId,
          name: 'Saved project acceptance test',
          inputMetadata: JSON.stringify({ genre: 'rock', sourceAudioStoredOnServer: false }),
          renderSettings: JSON.stringify({ intensity: 0.72, targetLufs: -14 }),
          status: 'rendered',
        },
      })
      await db.event.create({
        data: {
          userId,
          type: 'export_completed',
          metadata: JSON.stringify({ format: 'wav24', testFixture: true }),
        },
      })
      const payment = await db.payment.create({
        data: {
          userId,
          provider: 'integration-test',
          providerPaymentId: `payment-${suffix}`,
          providerEventId: `provider-event-${suffix}`,
          idempotencyKey: `payment-idempotency-${suffix}`,
          amountCents: 4900,
          currency: 'ZAR',
          purpose: 'beta_unlock',
          status: 'verified',
          verifiedAt: new Date(),
        },
      })
      const entitlement = await db.entitlement.create({
        data: {
          userId,
          sourcePaymentId: payment.id,
          kind: 'beta_r49_unlock',
          status: 'active',
        },
      })
      const usage = await db.usageRecord.create({
        data: {
          userId,
          kind: 'use_credit',
          status: 'completed',
          idempotencyKey: `usage-idempotency-${suffix}`,
          completedAt: new Date(),
        },
      })

      // A second independent connection proves these are durable database
      // rows, not just React state or an in-memory request/session object.
      const [persistedAccount, persistedToken, persistedProject, persistedEvent, persistedPayment, persistedEntitlement, persistedUsage] = await Promise.all([
        verifier!.account.findUnique({ where: { email } }),
        verifier!.authToken.findFirst({ where: { userId } }),
        verifier!.session.findUnique({ where: { id: project.id } }),
        verifier!.event.findFirst({ where: { userId, type: 'export_completed' } }),
        verifier!.payment.findUnique({ where: { id: payment.id } }),
        verifier!.entitlement.findUnique({ where: { id: entitlement.id } }),
        verifier!.usageRecord.findUnique({ where: { id: usage.id } }),
      ])

      expect(persistedAccount?.id).toBe(userId)
      expect(persistedAccount?.passwordHash).toContain('scrypt$')
      expect(persistedToken?.userId).toBe(userId)
      expect(persistedToken?.expiresAt.getTime()).toBeGreaterThan(Date.now())
      expect(persistedProject?.userId).toBe(userId)
      expect(JSON.parse(persistedProject?.renderSettings ?? '{}').targetLufs).toBe(-14)
      expect(persistedEvent?.userId).toBe(userId)
      expect(JSON.parse(persistedEvent?.metadata ?? '{}').format).toBe('wav24')
      expect(persistedPayment?.amountCents).toBe(4900)
      expect(persistedPayment?.status).toBe('verified')
      expect(persistedEntitlement?.sourcePaymentId).toBe(payment.id)
      expect(persistedEntitlement?.kind).toBe('beta_r49_unlock')
      expect(persistedUsage?.kind).toBe('use_credit')
      expect(persistedUsage?.status).toBe('completed')
    } finally {
      if (userId) {
        await db.usageRecord.deleteMany({ where: { userId } }).catch(() => {})
        await db.event.deleteMany({ where: { userId } }).catch(() => {})
        await db.account.delete({ where: { id: userId } }).catch(() => {})
      }
    }
  })
})
