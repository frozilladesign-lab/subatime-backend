import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { AppModule } from './app.module';
import { applyHttpLayer } from './http-app';

let cached: express.Express | undefined;

/**
 * Express instance for Vercel serverless (`api/[[...path]].ts`).
 * Cached across invocations to reduce cold-start cost.
 */
export async function getVercelExpressApp(): Promise<express.Express> {
  if (cached) return cached;
  const server = express();
  const adapter = new ExpressAdapter(server);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, adapter, { bufferLogs: true });
  applyHttpLayer(app);
  await app.init();
  cached = app.getHttpAdapter().getInstance();
  return cached;
}
