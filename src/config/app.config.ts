import { Injectable } from '@nestjs/common';

@Injectable()
export class AppConfigService {
  get nodeEnv(): string {
    return process.env.NODE_ENV ?? 'development';
  }

  get port(): number {
    return Number(process.env.PORT ?? 3000);
  }
}
