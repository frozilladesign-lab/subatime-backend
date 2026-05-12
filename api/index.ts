import { join } from 'node:path';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Application, Request, Response } from 'express';

function missingPrismaEnv(): string | null {
  if (!process.env.POSTGRES_PRISMA_URL?.trim()) return 'POSTGRES_PRISMA_URL';
  if (!process.env.POSTGRES_URL_NON_POOLING?.trim()) return 'POSTGRES_URL_NON_POOLING';
  return null;
}

function bootstrapHint(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/POSTGRES|PRISMA|environment variable not found|P10\d{2}/i.test(m)) {
    return 'Database env: set POSTGRES_PRISMA_URL and POSTGRES_URL_NON_POOLING for this Vercel environment (Preview vs Production), then redeploy.';
  }
  if (/Cannot find module|MODULE_NOT_FOUND|geo-tz|swisseph|\.node/i.test(m)) {
    return 'Native or data module failed to load — check Vercel Runtime logs and vercel.json includeFiles (geo-tz, @swisseph).';
  }
  return 'Open Vercel → this deployment → Runtime Logs for the stack trace.';
}

/**
 * Vercel serverless entry for **all** `/api` traffic.
 * Use `api/index.ts` + `vercel.json` rewrites (`/api` → `/api`, `/api/(.*)` → `/api`) so
 * multi-segment routes (e.g. `/api/auth/login`) reach Nest; root `api/[...path].ts` alone
 * did not receive those paths on this runtime.
 *
 * Requires `nest build` output under `dist/` (see `vercel.json` `includeFiles`).
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const missing = missingPrismaEnv();
  if (missing) {
    console.error('[api/index] missing env:', missing);
    if (!res.headersSent) {
      res.status(503).json({
        statusCode: 503,
        message: `Missing ${missing}. Prisma needs both POSTGRES_PRISMA_URL and POSTGRES_URL_NON_POOLING on Vercel (Preview deployments need Preview env vars).`,
      });
    }
    return;
  }

  try {
    const entryPath = join(process.cwd(), 'dist', 'vercel-entry.js');
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime load of compiled Nest bundle
    const { getVercelExpressApp } = require(entryPath) as {
      getVercelExpressApp: () => Promise<Application>;
    };
    const app = await getVercelExpressApp();
    app(req as Request, res as Response);
  } catch (err) {
    console.error('[api/index] bootstrap failed', err);
    if (!res.headersSent) {
      res.status(500).json({
        statusCode: 500,
        message: 'Server bootstrap failed',
        hint: bootstrapHint(err),
      });
    }
  }
}
