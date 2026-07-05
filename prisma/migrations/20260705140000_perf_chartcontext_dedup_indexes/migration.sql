-- P0 perf audit: cache chart-context to avoid Swiss-Ephemeris recompute on cache-read,
-- and drop two redundant duplicate indexes (covered by existing unique constraints).
ALTER TABLE "daily_predictions" ADD COLUMN "chartContext" JSONB;

-- @@unique([userId, date]) already serves point + range lookups.
DROP INDEX IF EXISTS "daily_predictions_userId_date_idx";

-- @@unique([userId, deviceId]) covers userId-only lookups via leftmost prefix.
DROP INDEX IF EXISTS "user_local_notification_schedules_userId_idx";
