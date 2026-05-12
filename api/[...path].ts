import { join } from 'node:path';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Application, Request, Response } from 'express';

/**
 * Vercel serverless entry: forwards `/api/**` to the Nest Express stack.
 * Uses a *required* catch-all (`[...path]`) so multi-segment routes (e.g. `/api/auth/login`)
 * are routed here; `[[...path]]` only matched a single segment on this runtime.
 *
 * Requires `nest build` output under `dist/` (see `vercel.json` `includeFiles`).
 * `process.cwd()` + `dist/…` — relative `../dist` breaks after `@vercel/node` bundles this file.
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
    console.error('[api/[...path]] bootstrap failed', err);
    if (!res.headersSent) {
      res.status(500).json({ statusCode: 500, message: 'Server bootstrap failed' });
    }
  }
}
