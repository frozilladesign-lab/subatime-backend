import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType, Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../../database/prisma.service';
import { AlmanacService } from '../calendar/almanac.service';
import { subhaDirectionOppositeMaru } from '../calendar/jyotisha-hora-lagna';
import { buildSubhaTimePushData } from '../push/firebase-push.service';

const LEAD_MS = 15 * 60 * 1000;
/** Skip alerts that would fire in the immediate past or too soon to be useful. */
const MIN_LEAD_AHEAD_MS = 90 * 1000;
/** Do not schedule pushes more than this far ahead (hourly cron will re-run). */
const MAX_SCHEDULE_HORIZON_MS = 36 * 60 * 60 * 1000;

/**
 * Upserts `NotificationJob` rows for favorable horā windows (15 min before start),
 * using the same FCM progressive-disclosure payload as manual Subha pushes.
 * Delivery is handled by [NotificationPushDispatcherService] (and optional BullMQ worker).
 */
@Injectable()
export class ProactiveHoraPushSchedulerService {
  private readonly logger = new Logger(ProactiveHoraPushSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almanac: AlmanacService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async scheduleUpcomingFavorableHoraAlerts(): Promise<void> {
    if (process.env.DISABLE_PROACTIVE_HORA_SCHEDULER === 'true') {
      return;
    }

    const now = Date.now();
    let jobsTouched = 0;
    let usersConsidered = 0;

    const rows = await this.prisma.user.findMany({
      where: {
        deviceTokens: { some: {} },
        birthProfile: { isNot: null },
      },
      select: {
        id: true,
        preferences: true,
        birthProfile: {
          select: {
            timezone: true,
            latitude: true,
            longitude: true,
            lagna: true,
            charts: {
              orderBy: { version: 'desc' },
              take: 1,
              select: { chartData: true },
            },
          },
        },
      },
    });

    for (const u of rows) {
      try {
        if (!this.userWantsProactiveHora(u.preferences)) continue;
        const bp = u.birthProfile;
        if (!bp) continue;

        const lagna = this.resolveLagna(bp);
        if (!lagna) continue;

        const tz = (bp.timezone ?? '').trim() || 'Asia/Colombo';
        const dateStr = DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');

        const envelope = this.almanac.computeDay({
          date: dateStr,
          timezone: tz,
          latitude: bp.latitude,
          longitude: bp.longitude,
          lagna,
        }) as { data?: Record<string, unknown> };
        const data = envelope.data;
        if (!data) continue;

        const maru = String(data['maruDirection'] ?? '').trim();
        const subha = (maru && subhaDirectionOppositeMaru(maru)) || 'South';

        const dayHoras = (data['dayHoras'] as unknown[]) ?? [];
        const nightHoras = (data['nightHoras'] as unknown[]) ?? [];
        const horas = [...dayHoras, ...nightHoras];

        let anyForUser = false;
        for (const h of horas) {
          if (!h || typeof h !== 'object') continue;
          const m = h as Record<string, unknown>;
          if (m['personalStatus'] !== 'favorable') continue;

          const lord = String(m['lord'] ?? '').trim();
          const startIso = String(m['startUtc'] ?? '');
          const endIso = String(m['endUtc'] ?? '');
          if (!lord || !startIso || !endIso) continue;

          const startMs = Date.parse(startIso);
          if (!Number.isFinite(startMs)) continue;

          const alertAt = new Date(startMs - LEAD_MS);
          const tAlert = alertAt.getTime();
          if (tAlert <= now + MIN_LEAD_AHEAD_MS) continue;
          if (tAlert > now + MAX_SCHEDULE_HORIZON_MS) continue;

          const timeBlock = `${this.formatHm(startIso, tz)}–${this.formatHm(endIso, tz)}`;
          const title = '🌟 Your power hour soon';
          const body = `A favorable ${lord} Horā for your ${lagna} chart starts in 15 minutes.`;
          const fcmData = buildSubhaTimePushData({
            timeBlock,
            reasonTitle: 'Personalized power hour',
            reasonDetails: `This ${lord} Horā is favorable for your ${lagna} ascendant (whole-sign matrix). A strong window for priorities and clear decisions.`,
            maruDirection: maru || 'North',
            subhaDishawa: subha,
          });

          const whereUnique = {
            userId_type_scheduledAt: {
              userId: u.id,
              type: NotificationType.proactive_hora,
              scheduledAt: alertAt,
            },
          };

          const existing = await this.prisma.notificationJob.findUnique({ where: whereUnique });
          if (existing?.status === 'sent') continue;

          if (existing == null) {
            await this.prisma.notificationJob.create({
              data: {
                userId: u.id,
                type: NotificationType.proactive_hora,
                scheduledAt: alertAt,
                status: 'pending',
                payload: { title, body, fcmData } as Prisma.InputJsonValue,
              },
            });
          } else {
            await this.prisma.notificationJob.update({
              where: whereUnique,
              data: {
                status: 'pending',
                payload: { title, body, fcmData } as Prisma.InputJsonValue,
              },
            });
          }
          jobsTouched += 1;
          anyForUser = true;
        }
        if (anyForUser) usersConsidered += 1;
      } catch (e) {
        this.logger.warn(`Proactive horā: skipped user ${u.id}: ${String(e)}`);
      }
    }

    if (jobsTouched > 0) {
      this.logger.log(
        `Proactive horā scheduler: touched ${jobsTouched} job(s) across ${usersConsidered} user(s).`,
      );
    }
  }

  private userWantsProactiveHora(prefs: Prisma.JsonValue): boolean {
    if (prefs == null || typeof prefs !== 'object' || Array.isArray(prefs)) return true;
    const o = prefs as Record<string, unknown>;
    if (o['proactiveHoraAlerts'] === false) return false;
    const n = o['notifications'];
    if (n != null && typeof n === 'object' && !Array.isArray(n)) {
      const nr = n as Record<string, unknown>;
      if (nr['proactiveHoraAlerts'] === false) return false;
    }
    return true;
  }

  private resolveLagna(bp: {
    lagna: string | null;
    charts: { chartData: Prisma.JsonValue }[];
  }): string | undefined {
    const chart0 = bp.charts[0];
    let fromChart = '';
    if (chart0?.chartData && typeof chart0.chartData === 'object' && !Array.isArray(chart0.chartData)) {
      const cd = chart0.chartData as Record<string, unknown>;
      fromChart = String(cd['lagna'] ?? '').trim();
    }
    const fromProfile = (bp.lagna ?? '').trim();
    const s = fromChart || fromProfile;
    return s.length ? s : undefined;
  }

  private formatHm(isoUtc: string, tz: string): string {
    const d = DateTime.fromISO(isoUtc, { zone: 'utc' }).setZone(tz);
    if (!d.isValid) return isoUtc.slice(11, 16);
    return d.toFormat('HH:mm');
  }
}
