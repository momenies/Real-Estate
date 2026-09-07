import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { NextFunction, Request, Response } from 'express';
import { TenantStore } from './tenant-context';
import { AuthenticatedUser } from '../decorators';

/**
 * Opens the tenant scope for the whole request.
 *
 * This has to be middleware rather than a guard: AsyncLocalStorage only
 * survives inside the callback it was started with, and middleware is the one
 * layer whose `next()` encloses the guards, the handler and every service call
 * underneath it.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly jwt: JwtService) {}

  use(req: Request & { user?: AuthenticatedUser }, _res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    let user: AuthenticatedUser | undefined;

    if (header?.startsWith('Bearer ')) {
      try {
        const payload = this.jwt.verify<{
          sub: string;
          role: UserRole;
          officeId: string | null;
          name: string;
        }>(header.slice(7));
        user = {
          id: payload.sub,
          role: payload.role,
          officeId: payload.officeId ?? null,
          name: payload.name,
        };
        req.user = user;
      } catch {
        // Leave the request anonymous; the guard produces the 401.
      }
    }

    const isSuperAdmin = user?.role === UserRole.SUPER_ADMIN;
    TenantStore.run(
      {
        officeId: isSuperAdmin ? null : (user?.officeId ?? null),
        isSuperAdmin,
        userId: user?.id ?? null,
        actor: 'api',
      },
      () => next(),
    );
  }
}
