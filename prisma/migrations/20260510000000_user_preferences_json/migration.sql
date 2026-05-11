-- Client preferences (adaptation sliders, future keys) — merged by PATCH /api/user/preferences
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferences" JSONB NOT NULL DEFAULT '{}'::jsonb;
