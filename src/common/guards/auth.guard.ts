import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { JwtTokenService } from '../../modules/auth/jwt-token.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = auth.slice('Bearer '.length).trim();
    if (!token || token === 'undefined' || token === 'null') {
      throw new UnauthorizedException('Invalid bearer token');
    }
    if (token.startsWith('st_')) {
      throw new UnauthorizedException('Legacy token rejected. Please log in again.');
    }
    try {
      const userId = this.jwt.verifyAccessToken(token);
      req.user = { id: userId };
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid bearer token');
    }
  }
}
