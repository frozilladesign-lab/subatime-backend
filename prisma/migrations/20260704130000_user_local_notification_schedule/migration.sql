-- Local-notification schedule state per user+device, reported by the app after successful
-- local scheduling. Backend FCM block push uses this to skip fresh devices (dedup).
CREATE TABLE "user_local_notification_schedules" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" TEXT NOT NULL,
    "lastLocalScheduleAt" TIMESTAMP(3) NOT NULL,
    "localScheduleThroughDate" TEXT,
    "deviceTimezone" TEXT,
    "notificationPermissionStatus" TEXT,
    "scheduledCandidateIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_local_notification_schedules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_local_notification_schedules_userId_deviceId_key" ON "user_local_notification_schedules"("userId", "deviceId");
CREATE INDEX "user_local_notification_schedules_userId_idx" ON "user_local_notification_schedules"("userId");

ALTER TABLE "user_local_notification_schedules" ADD CONSTRAINT "user_local_notification_schedules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
