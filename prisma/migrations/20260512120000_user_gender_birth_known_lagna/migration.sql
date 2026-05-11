-- Optional onboarding / calibration fields
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gender" TEXT;
ALTER TABLE "birth_profiles" ADD COLUMN IF NOT EXISTS "userKnownLagna" TEXT;
