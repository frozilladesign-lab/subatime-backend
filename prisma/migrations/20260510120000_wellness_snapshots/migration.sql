-- CreateEnum
CREATE TYPE "WellnessSnapshotSource" AS ENUM ('personalize_submit', 'nightly_checkin');

-- CreateTable
CREATE TABLE "wellness_snapshots" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "planDate" DATE,
    "sleepQuality" INTEGER NOT NULL,
    "stressLevel" INTEGER NOT NULL,
    "fatigueLevel" INTEGER NOT NULL,
    "source" "WellnessSnapshotSource" NOT NULL,

    CONSTRAINT "wellness_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wellness_snapshots_userId_recordedAt_idx" ON "wellness_snapshots"("userId", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "wellness_snapshots_userId_planDate_idx" ON "wellness_snapshots"("userId", "planDate");

-- AddForeignKey
ALTER TABLE "wellness_snapshots" ADD CONSTRAINT "wellness_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
