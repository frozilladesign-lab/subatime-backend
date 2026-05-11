-- Prefer: set DIRECT_URL in .env (Supabase direct connection) and run `npm run prisma:migrate:deploy`.
-- Fallback: run this in Supabase Dashboard → SQL Editor if the app returns 500 and logs show:
--   The column `users.gender` does not exist
--   The column `birth_profiles.userKnownLagna` does not exist
-- (Pooler session limits can block `prisma migrate deploy`; this applies the same DDL safely.)

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gender" TEXT;
ALTER TABLE "birth_profiles" ADD COLUMN IF NOT EXISTS "userKnownLagna" TEXT;

DO $$
BEGIN
  ALTER TYPE "NotificationType" ADD VALUE 'proactive_hora';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- After this succeeds, mark migrations as applied from your machine (when pooler allows),
-- or Prisma may try to re-apply them:
--   npx prisma migrate resolve --applied 20260512120000_user_gender_birth_known_lagna
--   npx prisma migrate resolve --applied 20260512140000_notification_type_proactive_hora
