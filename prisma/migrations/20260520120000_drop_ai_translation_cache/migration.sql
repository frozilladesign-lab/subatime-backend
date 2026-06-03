-- Runtime Sinhala/English copy is resolved on the client; Gemini translation cache is unused.
DROP POLICY IF EXISTS ai_translation_cache_deny_authenticated ON public.ai_translation_cache;
DROP TABLE IF EXISTS public.ai_translation_cache;
