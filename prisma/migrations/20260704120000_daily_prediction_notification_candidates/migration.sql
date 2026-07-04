-- Single source of notification wording per prediction day (engine buildNotificationCandidates).
ALTER TABLE "daily_predictions" ADD COLUMN "notificationCandidates" JSONB;
