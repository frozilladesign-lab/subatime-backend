-- Persist score spread + dominant context so plan/month reads one query instead of N× full generation.
ALTER TABLE "daily_predictions" ADD COLUMN "scoreSpread" DOUBLE PRECISION NOT NULL DEFAULT 0.35;
ALTER TABLE "daily_predictions" ADD COLUMN "dominantContext" TEXT NOT NULL DEFAULT 'overall';
