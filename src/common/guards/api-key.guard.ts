import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    // Placeholder guard. Replace with real key validation for privileged routes.
    return true;
  }
}
