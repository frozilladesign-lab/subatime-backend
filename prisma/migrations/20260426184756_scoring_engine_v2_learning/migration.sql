-- AlterTable
ALTER TABLE "prediction_feedback" ADD COLUMN     "contextType" TEXT,
ADD COLUMN     "timeSlot" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "accuracyScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5;
