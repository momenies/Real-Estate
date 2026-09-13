import { Controller, Get, Redirect } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators';
import { PrismaService } from './common/prisma/prisma.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Anyone opening the deployed URL lands here. Without this they get a bare
   * `Cannot GET /`, which reads as a broken deploy even though nothing is wrong.
   */
  @Public()
  @Get()
  @Redirect('/dashboard/', 302)
  root() {
    return undefined;
  }

  @Public()
  @Get('health')
  async health() {
    // Railway's healthcheck should fail if the database is unreachable.
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
