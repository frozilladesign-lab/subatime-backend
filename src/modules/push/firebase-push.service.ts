import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import * as admin from 'firebase-admin';
import type { ServiceAccount } from 'firebase-admin';

/**
 * FCM `data` map for Subha / Abhijit-style alerts (progressive disclosure).
 * Keep values short strings; the client shows `notification.title/body` on the lock screen
 * and only surfaces `reasonTitle`, `reasonDetails`, directions, etc. after tap.
 * Android requires string values in `data`.
 */
export function buildSubhaTimePushData(params: {
  timeBlock: string;
  reasonTitle: string;
  reasonDetails: string;
  maruDirection: string;
  subhaDishawa: string;
}): Record<string, string> {
  return {
    click_action: 'FLUTTER_NOTIFICATION_CLICK',
    alertType: 'SUBHA_TIME',
    timeBlock: params.timeBlock,
    reasonTitle: params.reasonTitle,
    reasonDetails: params.reasonDetails,
    maruDirection: params.maruDirection,
    subhaDishawa: params.subhaDishawa,
  };
}

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
   * Use a short `notification` for the tray; put astrology copy in `data` (see [buildSubhaTimePushData]).
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
    // 1. Base64-encoded full service account JSON (best for Vercel/cloud).
    const b64 = process.env.FIREBASE_ADMIN_CREDENTIALS?.trim();
    if (b64) {
      try {
        const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as ServiceAccount;
        return admin.credential.cert(parsed);
      } catch (e) {
        this.logger.error(`FIREBASE_ADMIN_CREDENTIALS is set but invalid: ${String(e)}`);
        return null;
      }
    }

    // 2. Path to service account JSON file.
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

    // 3. Separate env vars — supports FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.
    //    Vercel env vars often have literal \n that must become real newlines in the private key.
    const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim().replace(/\\n/g, '\n');
    if (projectId && clientEmail && privateKey) {
      try {
        this.logger.log(`Firebase credential: using FIREBASE_PROJECT_ID=${projectId}`);
        return admin.credential.cert({ projectId, clientEmail, privateKey } as ServiceAccount);
      } catch (e) {
        this.logger.error(`Separate FIREBASE_ env vars credential failed: ${String(e)}`);
        return null;
      }
    }

    return null;
  }

  /** Returns which credential source is detected — safe to log, no secret values exposed. */
  credentialSource(): string {
    if (process.env.FIREBASE_ADMIN_CREDENTIALS?.trim()) return 'FIREBASE_ADMIN_CREDENTIALS';
    const p = process.env.FIREBASE_ADMIN_KEY_PATH?.trim() || process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
    if (p) return `file:${p}`;
    const pid = process.env.FIREBASE_PROJECT_ID?.trim();
    if (pid && process.env.FIREBASE_CLIENT_EMAIL?.trim() && process.env.FIREBASE_PRIVATE_KEY?.trim()) return `project:${pid}`;
    return 'none';
  }
}
