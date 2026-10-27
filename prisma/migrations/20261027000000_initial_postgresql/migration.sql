-- Initial durable PostgreSQL schema for RAIN V6.
-- Apply with: prisma migrate deploy. Never use db push --accept-data-loss on live data.
CREATE TABLE "Account" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "tier" TEXT NOT NULL DEFAULT 'free',
  "name" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Account_email_key" ON "Account"("email");

CREATE TABLE "AuthToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "userAgent" TEXT,
  "ip" TEXT,
  CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");
CREATE INDEX "AuthToken_userId_idx" ON "AuthToken"("userId");
CREATE INDEX "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");

CREATE TABLE "PasswordResetToken" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "used" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");
CREATE INDEX "PasswordResetToken_userId_used_idx" ON "PasswordResetToken"("userId", "used");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Untitled',
  "inputFileHash" TEXT,
  "inputMetadata" TEXT,
  "renderSettings" TEXT,
  "rainDspWasmHash" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

CREATE TABLE "Render" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "outputFileHash" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "loudnessLufs" DOUBLE PRECISION,
  "truePeakDbfs" DOUBLE PRECISION,
  "renderTimeMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Render_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Render_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Render_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Render_userId_createdAt_idx" ON "Render"("userId", "createdAt");
CREATE INDEX "Render_sessionId_idx" ON "Render"("sessionId");

CREATE TABLE "InferenceJob" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InferenceJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InferenceJob_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "InferenceJob_status_idx" ON "InferenceJob"("status");

CREATE TABLE "Feedback" (
  "id" TEXT NOT NULL,
  "comment" TEXT NOT NULL,
  "email" TEXT,
  "allowFollowUp" BOOLEAN NOT NULL DEFAULT false,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

CREATE TABLE "Event" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "anonId" TEXT,
  "type" TEXT NOT NULL,
  "metadata" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Event_userId_type_createdAt_idx" ON "Event"("userId", "type", "createdAt");
CREATE INDEX "Event_anonId_type_createdAt_idx" ON "Event"("anonId", "type", "createdAt");
CREATE INDEX "Event_type_createdAt_idx" ON "Event"("type", "createdAt");

CREATE TABLE "Review" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "name" TEXT NOT NULL,
  "role" TEXT,
  "rating" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "approved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Review_approved_createdAt_idx" ON "Review"("approved", "createdAt");
