import { Controller, Get } from '@nestjs/common';
import { okResponse } from './common/utils/response.util';
import { PrismaService } from './database/prisma.service';

/** Public probes for uptime / DB connectivity (Vercel, load balancers, manual checks). */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  ping() {
    return okResponse({ ok: true }, 'ok');
  }

  @Get('db')
  async db() {
    await this.prisma.$queryRaw`SELECT 1`;
    return okResponse({ db: true }, 'Database reachable');
  }
}
