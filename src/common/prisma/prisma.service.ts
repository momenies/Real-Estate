import { INestApplication, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { tenantExtension } from './tenant.extension';
import { TenantStore } from '../tenancy/tenant-context';

const createTenantClient = (base: PrismaClient) => base.$extends(tenantExtension);
export type TenantPrisma = ReturnType<typeof createTenantClient>;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Tenant-safe client. Use this everywhere.
   *
   * `this` (the bare PrismaClient) stays available for the handful of places
   * that legitimately run before a tenant is known - webhook routing by
   * phone_number_id, super-admin login, and cron jobs that iterate offices.
   * Those call sites are few and are meant to stand out in review.
   */
  readonly tenant: TenantPrisma;

  constructor() {
    super({
      log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn', 'error'] : ['warn', 'error'],
    });
    this.tenant = createTenantClient(this);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to the central database');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  enableShutdownHooks(app: INestApplication): void {
    process.on('beforeExit', () => {
      void app.close();
    });
  }

  /**
   * Run work inside a transaction that also pins the tenant at the database
   * level, so PostgreSQL RLS applies in addition to the client extension.
   * `SET LOCAL` is transaction-scoped, so nothing leaks to the next borrower
   * of the pooled connection.
   */
  async runInTenantTransaction<T>(
    officeId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_office_id', $1, true)`, officeId);
      return TenantStore.runAsOffice(officeId, () => fn(tx));
    });
  }
}
