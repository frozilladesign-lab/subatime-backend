import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthConfig } from './auth.config';
import { JwtTokenService } from './jwt-token.service';
import { SessionService } from './session.service';
import { AuthGuard } from '../../common/guards/auth.guard';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthConfig, AuthService, JwtTokenService, SessionService, AuthGuard],
  exports: [AuthConfig, AuthService, JwtTokenService, SessionService, AuthGuard],
})
export class AuthModule {}
