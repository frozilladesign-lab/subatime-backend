-- Refresh-token sessions for JWT auth hardening.
CREATE TABLE public.user_sessions (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT user_sessions_pkey PRIMARY KEY (id)
);

CREATE INDEX user_sessions_userId_idx ON public.user_sessions("userId");
CREATE INDEX user_sessions_refreshTokenHash_idx ON public.user_sessions("refreshTokenHash");

ALTER TABLE public.user_sessions
ADD CONSTRAINT user_sessions_userId_fkey
FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_sessions_owner_all
ON public.user_sessions
FOR ALL
TO authenticated
USING ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid)
WITH CHECK ("userId" = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid);

REVOKE ALL ON TABLE public.user_sessions FROM anon, authenticated;
