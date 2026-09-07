import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { IS_PUBLIC_KEY, AuthenticatedUser } from '../decorators';

/**
 * The token was already verified by TenantContextMiddleware, which also opened
 * the tenant scope. This guard only decides whether the route needs a user.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const user: AuthenticatedUser | undefined = context.switchToHttp().getRequest().user;
    if (!user) throw new UnauthorizedException('Authentication required');
    if (user.role !== UserRole.SUPER_ADMIN && !user.officeId) {
      throw new UnauthorizedException('Account is not attached to an office');
    }
    return true;
  }
}
