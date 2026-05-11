import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import * as admin from 'firebase-admin';
import type { ServiceAccount } from 'firebase-admin';

/** FCM error codes that mean the token row should be deleted. */
export function isUnregisteredFcmError(code: string | undefined): boolean {
  if (!code) return false;
  return (
    code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token' ||
    code === 'messaging/unregistered'
  );
}

@Injectable()
export class FirebasePushService implements OnModuleInit {
  private readonly logger = new Logger(FirebasePushService.name);
  private messaging: admin.messaging.Messaging | null = null;

  onModuleInit(): void {
    if (admin.apps.length > 0) {
      this.messaging = admin.messaging();
      this.logger.log('Firebase Admin: reusing existing app.');
      return;
    }

    const credential = this.resolveCredential();
    if (!credential) {
      this.logger.warn(
        'Firebase Admin not configured. Set FIREBASE_ADMIN_CREDENTIALS (base64 JSON), ' +
          'FIREBASE_ADMIN_KEY_PATH, or GOOGLE_APPLICATION_CREDENTIALS to a service account file.',
      );
      return;
    }

    try {
      admin.initializeApp({ credential });
      this.messaging = admin.messaging();
      this.logger.log('Firebase Admin initialized for FCM delivery.');
    } catch (err) {
      this.logger.error(`Firebase Admin initializeApp failed: ${String(err)}`);
    }
  }

  /** True when FCM sends can be attempted. */
  isReady(): boolean {
    return this.messaging != null;
  }

  /**
   * Sends one notification per token (same title/body/data). Uses `sendEach` (up to 500 per HTTP request internally).
   */
  async sendEachToTokens(params: {
    tokens: string[];
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<admin.messaging.BatchResponse> {
    if (!this.messaging) {
      throw new Error('Firebase messaging is not configured');
    }
    const data = params.data ?? {};
    const tokens = params.tokens;
    const chunkSize = 500;
    const merged: admin.messaging.BatchResponse = {
      successCount: 0,
      failureCount: 0,
      responses: [],
    };
    for (let offset = 0; offset < tokens.length; offset += chunkSize) {
      const slice = tokens.slice(offset, offset + chunkSize);
      const messages: admin.messaging.Message[] = slice.map((token) => ({
        token,
        notification: { title: params.title, body: params.body },
        data,
      }));
      const batch = await this.messaging.sendEach(messages);
      merged.successCount += batch.successCount;
      merged.failureCount += batch.failureCount;
      merged.responses.push(...batch.responses);
    }
    return merged;
  }

  private resolveCredential(): admin.credential.Credential | null {
    const b64 = process.env.FIREBASE_ADMIN_CREDENTIALS?.trim();
    if (b64) {
      try {
        const json = Buffer.from(b64, 'base64').toString('utf8');
        const parsed = JSON.parse(json) as ServiceAccount;
        return admin.credential.cert(parsed);
      } catch (e) {
        this.logger.error(`FIREBASE_ADMIN_CREDENTIALS is set but invalid: ${String(e)}`);
        return null;
      }
    }

    const pathFromEnv =
      process.env.FIREBASE_ADMIN_KEY_PATH?.trim() || process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
    if (pathFromEnv && existsSync(pathFromEnv)) {
      try {
        const parsed = JSON.parse(readFileSync(pathFromEnv, 'utf8')) as ServiceAccount;
        return admin.credential.cert(parsed);
      } catch (e) {
        this.logger.error(`Failed to read service account JSON at ${pathFromEnv}: ${String(e)}`);
        return null;
      }
    }

    return null;
  }
}
