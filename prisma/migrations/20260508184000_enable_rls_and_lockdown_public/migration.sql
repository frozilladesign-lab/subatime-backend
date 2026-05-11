-- Supabase security hardening:
-- 1) Enable RLS on public tables flagged by Security Advisor
-- 2) Add owner-scoped policies for authenticated users
-- 3) Revoke broad table access from anon/authenticated roles
-- 4) Lock down sensitive token columns

-- Enable and enforce RLS on all flagged app tables.

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

ALTER TABLE public.birth_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.birth_profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.astrology_charts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.astrology_charts FORCE ROW LEVEL SECURITY;

ALTER TABLE public.daily_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_predictions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.prediction_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prediction_feedback FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_jobs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.match_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_results FORCE ROW LEVEL SECURITY;

ALTER TABLE public.ai_explanations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_explanations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports FORCE ROW LEVEL SECURITY;

ALTER TABLE public.user_device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_device_tokens FORCE ROW LEVEL SECURITY;

ALTER TABLE public.compatibility_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compatibility_profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.dream_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dream_entries FORCE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to keep migration idempotent.
DROP POLICY IF EXISTS users_owner_all ON public.users;
DROP POLICY IF EXISTS birth_profiles_owner_all ON public.birth_profiles;
DROP POLICY IF EXISTS astrology_charts_owner_all ON public.astrology_charts;
DROP POLICY IF EXISTS daily_predictions_owner_all ON public.daily_predictions;
DROP POLICY IF EXISTS prediction_feedback_owner_all ON public.prediction_feedback;
DROP POLICY IF EXISTS notification_jobs_owner_all ON public.notification_jobs;
DROP POLICY IF EXISTS notification_logs_owner_all ON public.notification_logs;
DROP POLICY IF EXISTS match_results_owner_all ON public.match_results;
DROP POLICY IF EXISTS ai_explanations_owner_all ON public.ai_explanations;
DROP POLICY IF EXISTS reports_owner_all ON public.reports;
DROP POLICY IF EXISTS user_device_tokens_owner_all ON public.user_device_tokens;
DROP POLICY IF EXISTS compatibility_profiles_owner_all ON public.compatibility_profiles;
DROP POLICY IF EXISTS dream_entries_owner_all ON public.dream_entries;

-- Owner-only policies (authenticated users can only access their own rows).
CREATE POLICY users_owner_all
ON public.users
FOR ALL
TO authenticated
USING (id = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid)
WITH CHECK (id = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid);

CREATE POLICY birth_profiles_owner_all
ON public.birth_profiles
FOR ALL
TO authenticated
USING ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid)
WITH CHECK ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid);

CREATE POLICY astrology_charts_owner_all
ON public.astrology_charts
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.birth_profiles bp
    WHERE bp.id = "birthProfileId"
      AND bp."userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.birth_profiles bp
    WHERE bp.id = "birthProfileId"
      AND bp."userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
  )
);

CREATE POLICY daily_predictions_owner_all
ON public.daily_predictions
FOR ALL
TO authenticated
USING ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid)
WITH CHECK ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid);

CREATE POLICY prediction_feedback_owner_all
ON public.prediction_feedback
FOR ALL
TO authenticated
USING ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid)
WITH CHECK ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid);

CREATE POLICY notification_jobs_owner_all
ON public.notification_jobs
FOR ALL
TO authenticated
USING ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid)
WITH CHECK ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid);

CREATE POLICY notification_logs_owner_all
ON public.notification_logs
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.notification_jobs nj
    WHERE nj.id = "jobId"
      AND nj."userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.notification_jobs nj
    WHERE nj.id = "jobId"
      AND nj."userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
  )
);

CREATE POLICY match_results_owner_all
ON public.match_results
FOR ALL
TO authenticated
USING (
  "userAId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
  OR "userBId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
)
WITH CHECK (
  "userAId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
  OR "userBId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
);

CREATE POLICY ai_explanations_owner_all
ON public.ai_explanations
FOR ALL
TO authenticated
USING ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid)
WITH CHECK ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid);

CREATE POLICY reports_owner_all
ON public.reports
FOR ALL
TO authenticated
USING ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid)
WITH CHECK ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid);

CREATE POLICY user_device_tokens_owner_all
ON public.user_device_tokens
FOR ALL
TO authenticated
USING ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid)
WITH CHECK ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid);

CREATE POLICY compatibility_profiles_owner_all
ON public.compatibility_profiles
FOR ALL
TO authenticated
USING ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid)
WITH CHECK ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid);

CREATE POLICY dream_entries_owner_all
ON public.dream_entries
FOR ALL
TO authenticated
USING ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid)
WITH CHECK ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid);

-- Lock down direct table exposure for API roles.
REVOKE ALL ON TABLE public.users FROM anon, authenticated;
REVOKE ALL ON TABLE public.birth_profiles FROM anon, authenticated;
REVOKE ALL ON TABLE public.astrology_charts FROM anon, authenticated;
REVOKE ALL ON TABLE public.daily_predictions FROM anon, authenticated;
REVOKE ALL ON TABLE public.prediction_feedback FROM anon, authenticated;
REVOKE ALL ON TABLE public.notification_jobs FROM anon, authenticated;
REVOKE ALL ON TABLE public.notification_logs FROM anon, authenticated;
REVOKE ALL ON TABLE public.match_results FROM anon, authenticated;
REVOKE ALL ON TABLE public.ai_explanations FROM anon, authenticated;
REVOKE ALL ON TABLE public.reports FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_device_tokens FROM anon, authenticated;
REVOKE ALL ON TABLE public.compatibility_profiles FROM anon, authenticated;
REVOKE ALL ON TABLE public.dream_entries FROM anon, authenticated;

-- Explicit extra protection for sensitive token column.
REVOKE SELECT ("token") ON public.user_device_tokens FROM anon, authenticated;
