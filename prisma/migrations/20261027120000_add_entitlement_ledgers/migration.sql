-- Add durable payment, entitlement and usage ledgers.
-- Existing migrations remain immutable; this additive migration is safe for deployed databases.
CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerPaymentId" TEXT,
  "providerEventId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'ZAR',
  "purpose" TEXT NOT NULL DEFAULT 'beta_unlock',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "metadata" TEXT,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");
CREATE UNIQUE INDEX "Payment_provider_providerPaymentId_key" ON "Payment"("provider", "providerPaymentId");
CREATE UNIQUE INDEX "Payment_provider_providerEventId_key" ON "Payment"("provider", "providerEventId");
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

CREATE TABLE "Entitlement" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourcePaymentId" TEXT,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadata" TEXT,
  CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Entitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Entitlement_sourcePaymentId_fkey" FOREIGN KEY ("sourcePaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Entitlement_sourcePaymentId_key" ON "Entitlement"("sourcePaymentId");
CREATE INDEX "Entitlement_userId_status_startsAt_endsAt_idx" ON "Entitlement"("userId", "status", "startsAt", "endsAt");
CREATE INDEX "Entitlement_kind_status_idx" ON "Entitlement"("kind", "status");

CREATE TABLE "UsageRecord" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "anonId" TEXT,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'reserved',
  "idempotencyKey" TEXT NOT NULL,
  "operationId" TEXT,
  "format" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "metadata" TEXT,
  CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UsageRecord_idempotencyKey_key" ON "UsageRecord"("idempotencyKey");
CREATE INDEX "UsageRecord_userId_kind_status_createdAt_idx" ON "UsageRecord"("userId", "kind", "status", "createdAt");
CREATE INDEX "UsageRecord_anonId_kind_status_createdAt_idx" ON "UsageRecord"("anonId", "kind", "status", "createdAt");
CREATE INDEX "UsageRecord_operationId_idx" ON "UsageRecord"("operationId");
