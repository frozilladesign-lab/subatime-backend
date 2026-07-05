-- Phase C: weekly/monthly digest storage. Unique (userId, kind, periodKey) enforces
-- max 1 weekly per ISO week and max 1 monthly per calendar month (no duplicates).
CREATE TABLE "user_digests" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_digests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_digests_userId_kind_periodKey_key" ON "user_digests"("userId", "kind", "periodKey");
CREATE INDEX "user_digests_userId_kind_idx" ON "user_digests"("userId", "kind");
ALTER TABLE "user_digests" ADD CONSTRAINT "user_digests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
