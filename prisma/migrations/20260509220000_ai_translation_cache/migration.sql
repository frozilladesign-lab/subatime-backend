CREATE TABLE "ai_translation_cache" (
    "id" UUID NOT NULL,
    "cacheKey" VARCHAR(64) NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "geminiModel" VARCHAR(128) NOT NULL,
    "sourceLang" VARCHAR(8) NOT NULL DEFAULT 'en',
    "targetLang" VARCHAR(8) NOT NULL DEFAULT 'si',
    "resultJson" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_translation_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_translation_cache_cacheKey_key" ON "ai_translation_cache"("cacheKey");

CREATE INDEX "ai_translation_cache_operation_expiresAt_idx" ON "ai_translation_cache"("operation", "expiresAt");
