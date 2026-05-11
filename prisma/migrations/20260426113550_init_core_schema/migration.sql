-- CreateEnum
CREATE TYPE "Language" AS ENUM ('si', 'en');

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('good', 'bad');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('daily', 'warning', 'event');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "AiExplanationType" AS ENUM ('chat', 'report', 'match');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('daily', 'match', 'full');

-- CreateEnum
CREATE TYPE "ReportGenerator" AS ENUM ('ai', 'system');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'si',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "birth_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "timeOfBirth" TIMESTAMP(3) NOT NULL,
    "placeOfBirth" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "lagna" TEXT,
    "nakshatra" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "birth_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "astrology_charts" (
    "id" UUID NOT NULL,
    "birthProfileId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "chartData" JSONB NOT NULL,
    "planetaryData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "astrology_charts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_predictions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "summary" TEXT NOT NULL,
    "goodTimes" JSONB NOT NULL,
    "badTimes" JSONB NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_feedback" (
    "id" UUID NOT NULL,
    "predictionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "feedback" "FeedbackType" NOT NULL,
    "actualOutcome" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prediction_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_jobs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "payload" JSONB NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryStatus" TEXT NOT NULL,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_results" (
    "id" UUID NOT NULL,
    "userAId" UUID NOT NULL,
    "userBId" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "breakdown" JSONB NOT NULL,
    "aiInsight" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_explanations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "AiExplanationType" NOT NULL,
    "input" JSONB NOT NULL,
    "output" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_explanations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "ReportType" NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "generatedBy" "ReportGenerator" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "birth_profiles_userId_key" ON "birth_profiles"("userId");

-- CreateIndex
CREATE INDEX "astrology_charts_birthProfileId_idx" ON "astrology_charts"("birthProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "astrology_charts_birthProfileId_version_key" ON "astrology_charts"("birthProfileId", "version");

-- CreateIndex
CREATE INDEX "daily_predictions_userId_date_idx" ON "daily_predictions"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_predictions_userId_date_key" ON "daily_predictions"("userId", "date");

-- CreateIndex
CREATE INDEX "prediction_feedback_predictionId_idx" ON "prediction_feedback"("predictionId");

-- CreateIndex
CREATE INDEX "prediction_feedback_userId_timestamp_idx" ON "prediction_feedback"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "notification_jobs_userId_scheduledAt_idx" ON "notification_jobs"("userId", "scheduledAt");

-- CreateIndex
CREATE INDEX "notification_jobs_status_scheduledAt_idx" ON "notification_jobs"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_jobs_userId_type_scheduledAt_key" ON "notification_jobs"("userId", "type", "scheduledAt");

-- CreateIndex
CREATE INDEX "notification_logs_jobId_sentAt_idx" ON "notification_logs"("jobId", "sentAt");

-- CreateIndex
CREATE INDEX "match_results_userAId_createdAt_idx" ON "match_results"("userAId", "createdAt");

-- CreateIndex
CREATE INDEX "match_results_userBId_createdAt_idx" ON "match_results"("userBId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_explanations_userId_type_createdAt_idx" ON "ai_explanations"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "reports_userId_type_createdAt_idx" ON "reports"("userId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "birth_profiles" ADD CONSTRAINT "birth_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "astrology_charts" ADD CONSTRAINT "astrology_charts_birthProfileId_fkey" FOREIGN KEY ("birthProfileId") REFERENCES "birth_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_predictions" ADD CONSTRAINT "daily_predictions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_feedback" ADD CONSTRAINT "prediction_feedback_predictionId_fkey" FOREIGN KEY ("predictionId") REFERENCES "daily_predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_feedback" ADD CONSTRAINT "prediction_feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_jobs" ADD CONSTRAINT "notification_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "notification_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_results" ADD CONSTRAINT "match_results_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_results" ADD CONSTRAINT "match_results_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_explanations" ADD CONSTRAINT "ai_explanations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
