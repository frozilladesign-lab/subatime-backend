import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { okResponse } from '../../common/utils/response.util';
import { PatchUserPreferencesDto } from './dto/user-preferences.dto';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  health() {
    return okResponse({ status: 'ok' }, 'User module healthy');
  }

  /**
   * Registers or refreshes a push token for the signed-in user.
   * `token` is globally unique — if the device logs into another account, the row moves to the new user.
   */
  async registerDeviceToken(userId: string, dto: RegisterDeviceTokenDto) {
    const token = dto.token.trim();
    if (!token) {
      throw new BadRequestException('token is required');
    }

    const row = await this.prisma.userDeviceToken.upsert({
      where: { token },
      create: {
        userId,
        token,
        platform: dto.platform,
      },
      update: {
        userId,
        platform: dto.platform,
      },
      select: { id: true, platform: true, updatedAt: true },
    });

    return okResponse(
      {
        id: row.id,
        platform: row.platform,
        updatedAt: row.updatedAt.toISOString(),
      },
      'Device token registered',
    );
  }

  /**
   * Delete a token row after FCM returns `UNREGISTERED` / equivalent — call from the push dispatcher (PR 3).
   */
  async removePushTokenByValue(rawToken: string): Promise<boolean> {
    const token = rawToken.trim();
    if (!token) return false;
    const res = await this.prisma.userDeviceToken.deleteMany({ where: { token } });
    return res.count > 0;
  }

  async getPreferences(userId: string) {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    const merged = this.normalizePreferencesJson(row?.preferences);
    return okResponse(merged, 'User preferences fetched');
  }

  async patchPreferences(userId: string, dto: PatchUserPreferencesDto) {
    if (dto.adaptation == null && dto.notifications == null) {
      throw new BadRequestException('Provide at least one preferences key (e.g. adaptation or notifications).');
    }

    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });

    const root = this.parseJsonObject(row?.preferences);
    let next: Record<string, unknown> = { ...root };

    if (dto.adaptation != null) {
      const storedAdapt = this.parseJsonObject(root.adaptation);
      const nextAdapt: Record<string, unknown> = { ...storedAdapt };
      const a = dto.adaptation;
      if (a.depth !== undefined) nextAdapt.depth = Math.round(Number(a.depth));
      if (a.sensitivity !== undefined) nextAdapt.sensitivity = Math.round(Number(a.sensitivity));
      if (a.dreamDepth !== undefined) nextAdapt.dreamDepth = Math.round(Number(a.dreamDepth));
      if (a.strictness !== undefined) nextAdapt.strictness = Math.round(Number(a.strictness));
      next = { ...next, adaptation: nextAdapt };
    }

    if (dto.notifications != null) {
      const storedNotif = this.parseJsonObject(root.notifications);
      const nextNotif: Record<string, unknown> = { ...storedNotif };
      const n = dto.notifications;
      if (n.muteLearningTips !== undefined) {
        nextNotif.muteLearningTips = Boolean(n.muteLearningTips);
      }
      if (n.proactiveHoraAlerts !== undefined) {
        nextNotif.proactiveHoraAlerts = Boolean(n.proactiveHoraAlerts);
      }
      next = { ...next, notifications: nextNotif };
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { preferences: next as Prisma.InputJsonValue },
    });

    const normalized = this.normalizePreferencesJson(next);
    return okResponse(normalized, 'User preferences updated');
  }

  private parseJsonObject(raw: unknown): Record<string, unknown> {
    if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
      return { ...(raw as Record<string, unknown>) };
    }
    return {};
  }

  /** Ensures stable shape for API clients. */
  private normalizePreferencesJson(raw: unknown): {
    adaptation: {
      depth: number;
      sensitivity: number;
      dreamDepth: number;
      strictness: number;
    };
    notifications: {
      muteLearningTips: boolean;
      proactiveHoraAlerts: boolean;
    };
  } {
    const defaults = {
      depth: 75,
      sensitivity: 60,
      dreamDepth: 80,
      strictness: 40,
    };
    const root =
      raw != null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const adaptRaw = root.adaptation;
    const adapt =
      adaptRaw != null && typeof adaptRaw === 'object' && !Array.isArray(adaptRaw)
        ? (adaptRaw as Record<string, unknown>)
        : {};
    const notifRaw = root.notifications;
    const notif =
      notifRaw != null && typeof notifRaw === 'object' && !Array.isArray(notifRaw)
        ? (notifRaw as Record<string, unknown>)
        : {};
    const num = (v: unknown, fallback: number): number => {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(100, Math.max(0, Math.round(n)));
    };
    const muteRaw = notif.muteLearningTips;
    const muteLearningTips = muteRaw === true || muteRaw === 'true';
    const proactiveRaw = notif.proactiveHoraAlerts;
    const proactiveHoraAlerts = proactiveRaw === false || proactiveRaw === 'false' ? false : true;
    return {
      adaptation: {
        depth: num(adapt.depth, defaults.depth),
        sensitivity: num(adapt.sensitivity, defaults.sensitivity),
        dreamDepth: num(adapt.dreamDepth, defaults.dreamDepth),
        strictness: num(adapt.strictness, defaults.strictness),
      },
      notifications: {
        muteLearningTips,
        proactiveHoraAlerts,
      },
    };
  }
}
