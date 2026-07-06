-- AI-first digest content: provenance + dedup/regeneration hashes on user_digests.
-- All columns nullable so existing rows remain valid (treated as template/stale on read).
ALTER TABLE "user_digests" ADD COLUMN "aiProvider" TEXT;
ALTER TABLE "user_digests" ADD COLUMN "contentStatus" TEXT;
ALTER TABLE "user_digests" ADD COLUMN "promptVersion" TEXT;
ALTER TABLE "user_digests" ADD COLUMN "locale" TEXT;
ALTER TABLE "user_digests" ADD COLUMN "focusHash" TEXT;
ALTER TABLE "user_digests" ADD COLUMN "chartHash" TEXT;
