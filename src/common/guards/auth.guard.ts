import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = auth.slice('Bearer '.length).trim();
    const userId = this.resolveUserId(token);
    if (!userId) {
      throw new UnauthorizedException('Invalid bearer token');
    }
    req.user = { id: userId };
    return true;
  }

  private resolveUserId(token: string): string | null {
    if (!token || token === 'undefined' || token === 'null') return null;
    if (token.startsWith('st_')) {
      try {
        const decoded = Buffer.from(token.slice(3), 'base64url').toString('utf8').trim();
        if (!decoded || decoded === 'undefined' || decoded === 'null') return null;
        return decoded;
      } catch {
        return null;
      }
    }
    // Backward-compatible fallback for local/dev tokens that directly pass user id.
    return token || null;
  }
}
