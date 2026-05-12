import { join } from 'node:path';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Application, Request, Response } from 'express';

/**
 * Vercel serverless entry for **all** `/api` traffic.
 * Use `api/index.ts` + `vercel.json` rewrites (`/api` → `/api`, `/api/(.*)` → `/api`) so
 * multi-segment routes (e.g. `/api/auth/login`) reach Nest; root `api/[...path].ts` alone
 * did not receive those paths on this runtime.
 *
 * Requires `nest build` output under `dist/` (see `vercel.json` `includeFiles`).
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
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
      res.status(500).json({ statusCode: 500, message: 'Server bootstrap failed' });
    }
  }
}
