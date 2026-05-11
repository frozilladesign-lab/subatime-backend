ALTER TABLE public.birth_profiles
ADD COLUMN IF NOT EXISTS "birthLocalDate" TEXT,
ADD COLUMN IF NOT EXISTS "birthLocalTime" TEXT,
ADD COLUMN IF NOT EXISTS "birthUtcTime" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "timezoneSource" TEXT,
ADD COLUMN IF NOT EXISTS "timezoneOffsetMinutes" INTEGER,
ADD COLUMN IF NOT EXISTS "migrationSource" TEXT;

-- Preserve deterministic migration semantics for legacy rows that only had UTC-ish fields.
UPDATE public.birth_profiles
SET "migrationSource" = COALESCE("migrationSource", 'legacy_utc_only')
WHERE ("birthLocalDate" IS NULL OR "birthLocalTime" IS NULL)
  AND "timeOfBirth" IS NOT NULL;
