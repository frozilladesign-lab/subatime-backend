import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Application, Request, Response } from 'express';

/**
 * Vercel serverless entry: forwards `/api/**` to the Nest Express stack.
 * Requires `nest build` output under `dist/` (see `vercel.json` `includeFiles`).
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime load of compiled Nest bundle
  const { getVercelExpressApp } = require('../dist/vercel-entry.js') as {
    getVercelExpressApp: () => Promise<Application>;
  };
  const app = await getVercelExpressApp();
  app(req as Request, res as Response);
}
