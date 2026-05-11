-- Supabase Security Advisor: RLS was never enabled on these tables (added after 20260508184000).

ALTER TABLE public.wellness_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wellness_snapshots FORCE ROW LEVEL SECURITY;

ALTER TABLE public.ai_translation_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_translation_cache FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wellness_snapshots_owner_all ON public.wellness_snapshots;
DROP POLICY IF EXISTS ai_translation_cache_deny_authenticated ON public.ai_translation_cache;

CREATE POLICY wellness_snapshots_owner_all
ON public.wellness_snapshots
FOR ALL
TO authenticated
USING ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid)
WITH CHECK ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid);

-- Server-side cache (no userId): no direct client access via PostgREST.
CREATE POLICY ai_translation_cache_deny_authenticated
ON public.ai_translation_cache
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

REVOKE ALL ON TABLE public.wellness_snapshots FROM anon, authenticated;
REVOKE ALL ON TABLE public.ai_translation_cache FROM anon, authenticated;
