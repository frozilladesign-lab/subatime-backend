import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

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
