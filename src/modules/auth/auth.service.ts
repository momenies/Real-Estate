import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string) {
    // Deliberately unscoped: at login time there is no tenant yet, and the
    // super admin belongs to no office at all.
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user?.passwordHash || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const token = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
      officeId: user.officeId,
      name: user.name,
    });

    return {
      accessToken: token,
      user: { id: user.id, name: user.name, role: user.role, officeId: user.officeId },
    };
  }

  /** Creates the platform owner on first boot if they do not exist yet. */
  async ensureSuperAdmin(): Promise<void> {
    const email = this.config.get<string>('superAdminEmail')!.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return;

    const password = this.config.get<string>('superAdminPassword')!;
    await this.prisma.user.create({
      data: {
        email,
        name: 'Platform Super Admin',
        role: UserRole.SUPER_ADMIN,
        passwordHash: await bcrypt.hash(password, 10),
        officeId: null,
      },
    });
    this.logger.warn(`Super admin created for ${email} - change the password immediately.`);
  }
}
