import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';

/** Shared HTTP stack for local `main` and Vercel serverless. */
export function applyHttpLayer(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: '8mb' });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
}
