import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType, Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import type { NotificationCandidates, PowerHourNotificationCandidate } from '@subatime/jyotisha-engine';
import { PrismaService } from '../../database/prisma.service';
import { AlmanacService } from '../calendar/almanac.service';
import { subhaDirectionOppositeMaru } from '../calendar/jyotisha-hora-lagna';
import { buildSubhaTimePushData } from '../push/firebase-push.service';

/** Skip alerts that would fire in the immediate past or too soon to be useful. */
const MIN_LEAD_AHEAD_MS = 90 * 1000;
/** Do not schedule pushes more than this far ahead (hourly cron will re-run). */
const MAX_SCHEDULE_HORIZON_MS = 36 * 60 * 60 * 1000;

/**
 * Upserts `NotificationJob` rows for favorable horā windows, using the same FCM
 * progressive-disclosure payload as manual Subha pushes. Delivery is handled by
 * [NotificationPushDispatcherService] (and optional BullMQ worker).
 *
 * Delivery-only: which horās are favorable, the send-at instant, and the title/body wording
 * all come from the stored engine-built `DailyPrediction.notificationCandidates.powerHours`.
 * The almanac is consulted only for the maru/subha direction fields of the existing FCM
 * payload contract — never for wording.
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

    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);

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
          },
        },
      },
    });

    for (const u of rows) {
      try {
        if (!this.userWantsProactiveHora(u.preferences)) continue;
        const bp = u.birthProfile;
        if (!bp) continue;

        const pred = await this.prisma.dailyPrediction.findUnique({
          where: { userId_date: { userId: u.id, date: todayUtc } },
          select: { notificationCandidates: true },
        });
        const candidates = this.parseCandidates(pred?.notificationCandidates);
        if (!candidates || candidates.powerHours.length === 0) continue;

        const tz = (bp.timezone ?? '').trim() || candidates.timezone || 'Asia/Colombo';
        const directions = this.dayDirections(candidates.date, tz, bp);

        // Phase B: when a plan exists, only its selected power hours go out
        // (advanced-frequency users); legacy rows keep the pre-plan behavior.
        const plan = (candidates as unknown as {
          plan?: { scheduled?: { candidateId?: string }[] };
        }).plan;
        const plannedIds = plan?.scheduled
          ? new Set(plan.scheduled.map((s) => s.candidateId))
          : null;

        let anyForUser = false;
        for (const ph of candidates.powerHours) {
          if (plannedIds && !plannedIds.has(ph.id)) continue;
          const alertMs = Date.parse(ph.sendAt);
          if (!Number.isFinite(alertMs)) continue;
          if (alertMs <= now + MIN_LEAD_AHEAD_MS) continue;
          if (alertMs > now + MAX_SCHEDULE_HORIZON_MS) continue;

          const alertAt = new Date(alertMs);
          const fcmData = buildSubhaTimePushData({
            timeBlock: this.formatWindow(ph, tz),
            reasonTitle: 'Personalized power hour',
            reasonDetails: ph.body,
            maruDirection: directions.maru,
            subhaDishawa: directions.subha,
          });
          fcmData['deepLink'] = ph.deepLink;
          fcmData['candidateId'] = ph.id;

          const whereUnique = {
            userId_type_scheduledAt: {
              userId: u.id,
              type: NotificationType.proactive_hora,
              scheduledAt: alertAt,
            },
          };

          const existing = await this.prisma.notificationJob.findUnique({ where: whereUnique });
          if (existing?.status === 'sent') continue;

          const payload = { title: ph.title, body: ph.body, fcmData };
          if (existing == null) {
            await this.prisma.notificationJob.create({
              data: {
                userId: u.id,
                type: NotificationType.proactive_hora,
                scheduledAt: alertAt,
                status: 'pending',
                payload,
              },
            });
          } else {
            await this.prisma.notificationJob.update({
              where: whereUnique,
              data: {
                status: 'pending',
                payload,
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

  private parseCandidates(raw: Prisma.JsonValue | null | undefined): NotificationCandidates | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    if (!Array.isArray(o.powerHours)) return null;
    return raw as unknown as NotificationCandidates;
  }

  /**
   * Maru/subha directions for the existing FCM payload contract. Direction metadata only —
   * wording lives in the candidate. Best-effort defaults when coordinates are missing.
   */
  private dayDirections(
    dateStr: string,
    tz: string,
    bp: { latitude: number | null; longitude: number | null; lagna: string | null },
  ): { maru: string; subha: string } {
    try {
      if (bp.latitude == null || bp.longitude == null) return { maru: 'North', subha: 'South' };
      const envelope = this.almanac.computeDay({
        date: dateStr,
        timezone: tz,
        latitude: bp.latitude,
        longitude: bp.longitude,
        lagna: (bp.lagna ?? '').trim() || undefined,
      }) as { data?: Record<string, unknown> };
      const maru = (typeof envelope.data?.['maruDirection'] === 'string'
        ? envelope.data['maruDirection']
        : '').trim();
      const subha = (maru && subhaDirectionOppositeMaru(maru)) || 'South';
      return { maru: maru || 'North', subha };
    } catch {
      return { maru: 'North', subha: 'South' };
    }
  }

  private formatWindow(ph: PowerHourNotificationCandidate, tz: string): string {
    return `${this.formatHm(ph.startTime, tz)}–${this.formatHm(ph.endTime, tz)}`;
  }

  private formatHm(isoUtc: string, tz: string): string {
    const d = DateTime.fromISO(isoUtc, { zone: 'utc' }).setZone(tz);
    if (!d.isValid) return isoUtc.slice(11, 16);
    return d.toFormat('HH:mm');
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
}
