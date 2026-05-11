import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const user = await prisma.user.upsert({
    where: { email: 'demo@subatime.app' },
    update: {},
    create: {
      name: 'Demo User',
      email: 'demo@subatime.app',
      language: 'si',
      birthProfile: {
        create: {
          dateOfBirth: new Date('1995-04-14T00:00:00.000Z'),
          timeOfBirth: new Date('1995-04-14T06:30:00.000Z'),
          placeOfBirth: 'Colombo, Sri Lanka',
          latitude: 6.9271,
          longitude: 79.8612,
          lagna: 'Kanya',
          nakshatra: 'Ashwini',
        },
      },
    },
    include: { birthProfile: true },
  });

  await prisma.dailyPrediction.upsert({
    where: {
      userId_date: {
        userId: user.id,
        date: new Date('2026-04-26T00:00:00.000Z'),
      },
    },
    update: {},
    create: {
      userId: user.id,
      date: new Date('2026-04-26T00:00:00.000Z'),
      summary: 'Focus on consistency and avoid impulsive decisions.',
      goodTimes: [{ from: '06:30', to: '08:00' }],
      badTimes: [{ from: '13:15', to: '14:45', reason: 'Rahu Kalam' }],
      confidenceScore: 0.74,
    },
  });

  await prisma.notificationJob.upsert({
    where: {
      userId_type_scheduledAt: {
        userId: user.id,
        type: 'daily',
        scheduledAt: new Date('2026-04-27T00:00:00.000Z'),
      },
    },
    update: {},
    create: {
      userId: user.id,
      type: 'daily',
      payload: {
        title: 'Daily SubaTime Summary',
        body: 'Your prediction for today is ready.',
      },
      scheduledAt: new Date('2026-04-27T00:00:00.000Z'),
      status: 'pending',
    },
  });

  if (user.birthProfile) {
    await prisma.astrologyChart.upsert({
      where: {
        birthProfileId_version: {
          birthProfileId: user.birthProfile.id,
          version: 1,
        },
      },
      update: {},
      create: {
        birthProfileId: user.birthProfile.id,
        version: 1,
        chartData: {
          lagna: 'Kanya',
          nakshatra: 'Ashwini',
        },
        planetaryData: {
          sun: 'Mesha',
          moon: 'Vrishabha',
        },
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
