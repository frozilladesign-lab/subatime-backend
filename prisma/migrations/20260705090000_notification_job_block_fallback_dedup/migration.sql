-- Persistent dedup for the hourly block-push FCM fallback (Phase 4).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'prediction_block_fallback';
ALTER TABLE "notification_jobs" ADD COLUMN "date" DATE;
ALTER TABLE "notification_jobs" ADD COLUMN "candidateId" TEXT;
-- NULLs are distinct in Postgres, so legacy job rows never collide.
CREATE UNIQUE INDEX "notification_jobs_userId_date_candidateId_type_key" ON "notification_jobs"("userId", "date", "candidateId", "type");
