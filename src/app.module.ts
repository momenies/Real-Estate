import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import configuration from './config/configuration';
import { PrismaModule } from './common/prisma/prisma.module';
import { TenantContextMiddleware } from './common/tenancy/tenant.middleware';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { OfficesModule } from './modules/offices/offices.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { LeadsModule } from './modules/leads/leads.module';
import { MediaModule } from './modules/media/media.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { BroadcastsModule } from './modules/broadcasts/broadcasts.module';
import { ExternalModule } from './modules/external/external.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    // Blunt protection for the public surface; the webhook is exempted below.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    AuthModule,
    OfficesModule,
    SubscriptionsModule,
    PropertiesModule,
    LeadsModule,
    MediaModule,
    WhatsappModule,
    BroadcastsModule,
    ExternalModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Runs before guards and handlers, so the tenant scope wraps the whole
    // request - see TenantContextMiddleware for why this cannot be a guard.
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
