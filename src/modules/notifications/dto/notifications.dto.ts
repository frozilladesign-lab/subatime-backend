import { IsArray, IsIn, IsISO8601, IsOptional, IsString, Matches } from 'class-validator';

export class ScheduleNotificationDto {
  @IsString()
  userId!: string;
  @IsIn(['daily', 'warning', 'event'])
  @IsOptional()
  type?: 'daily' | 'warning' | 'event';
  @IsString()
  title!: string;
  @IsString()
  body!: string;
  @IsString()
  scheduleAt!: string;
}

export class AdminSendNotificationDto {
  @IsOptional()
  @IsArray()
  userIds?: string[];

  @IsIn(['daily', 'warning', 'event'])
  @IsOptional()
  type?: 'daily' | 'warning' | 'event';

  @IsString()
  title!: string;

  @IsString()
  body!: string;

  @IsOptional()
  @IsString()
  scheduleAt?: string;
}

export class RegisterDeviceDto {
  @IsString()
  userId!: string;
  @IsString()
  token!: string;
  @IsIn(['android', 'ios'])
  platform!: 'android' | 'ios';
}

/**
 * App report sent AFTER local block notifications were successfully scheduled.
 * Lets the backend skip FCM block pushes for devices whose local schedule is fresh.
 */
export class ReportLocalScheduleDto {
  /** Stable app-install identifier generated and persisted by the app. */
  @IsString()
  deviceId!: string;

  /** ISO instant when local scheduling succeeded. */
  @IsISO8601()
  lastLocalScheduleAt!: string;

  /** Last local calendar date (yyyy-MM-dd, device timezone) covered by scheduled notifications. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  localScheduleThroughDate?: string;

  @IsOptional()
  @IsString()
  deviceTimezone?: string;

  @IsOptional()
  @IsIn(['granted', 'denied', 'unknown'])
  notificationPermissionStatus?: 'granted' | 'denied' | 'unknown';

  @IsOptional()
  @IsArray()
  scheduledCandidateIds?: string[];
}

export class NotificationLogsQueryDto {
  @IsOptional()
  @IsIn(['daily', 'warning', 'event'])
  type?: 'daily' | 'warning' | 'event';

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
