-- CreateTable
CREATE TABLE "compatibility_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "zodiacSign" TEXT NOT NULL,
    "birthLocation" TEXT NOT NULL,
    "timeOfBirth" TEXT NOT NULL,
    "purpose" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compatibility_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dream_entries" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mood" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dream_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "compatibility_profiles_userId_createdAt_idx" ON "compatibility_profiles"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "dream_entries_userId_createdAt_idx" ON "dream_entries"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "compatibility_profiles" ADD CONSTRAINT "compatibility_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dream_entries" ADD CONSTRAINT "dream_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
