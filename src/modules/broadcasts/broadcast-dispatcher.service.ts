import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BroadcastStatus, DeliveryStatus, MediaType, SkipReason } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantStore } from '../../common/tenancy/tenant-context';
import { isWithinQuietHours } from '../../common/utils/time.util';
import { LEAD, propertyCard } from '../whatsapp/messages';
import { WhatsappApiService } from '../whatsapp/whatsapp-api.service';
import { AntiSpamService } from './anti-spam.service';

/**
 * Sends queued broadcasts a few at a time.
 *
 * A database-backed queue is used rather than Redis so the platform runs on a
 * single Railway service. The pace is deliberate: bursts are exactly what gets
 * a WhatsApp number flagged, and the number is the office's lifeline.
 */
@Injectable()
export class BroadcastDispatcherService {
  private readonly logger = new Logger(BroadcastDispatcherService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappApiService,
    private readonly antiSpam: AntiSpamService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick(): Promise<void> {
    if (this.running) return; // never overlap two dispatch passes
    this.running = true;
    try {
      await this.dispatchPending();
    } catch (error) {
      this.logger.error(`Dispatch pass failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async dispatchPending(): Promise<void> {
    const broadcasts = await TenantStore.runAsSuperAdmin(() =>
      this.prisma.broadcast.findMany({
        where: { status: { in: [BroadcastStatus.QUEUED, BroadcastStatus.SENDING] } },
        include: {
          office: { include: { settings: true } },
          property: { include: { media: { orderBy: { sortOrder: 'asc' } } } },
        },
        take: 10,
      }),
    );

    for (const broadcast of broadcasts) {
      const office = broadcast.office;
      const settings = office.settings;
      if (!settings || !office.whatsappPhoneNumberId) continue;

      if (isWithinQuietHours(office.timezone, settings.quietHoursStart, settings.quietHoursEnd)) {
        continue; // resume automatically once the quiet window closes
      }

      // One pass never exceeds the office's per-minute allowance.
      const batchSize = Math.max(1, Math.floor(settings.broadcastRatePerMinute / 2));

      await TenantStore.runAsOffice(office.id, async () => {
        const pending = await this.prisma.tenant.broadcastRecipient.findMany({
          where: { broadcastId: broadcast.id, status: DeliveryStatus.PENDING },
          include: { lead: true },
          take: batchSize,
          orderBy: { createdAt: 'asc' },
        });

        if (pending.length === 0) {
          await this.complete(broadcast.id);
          return;
        }

        if (broadcast.status === BroadcastStatus.QUEUED) {
          await this.prisma.tenant.broadcast.update({
            where: { id: broadcast.id },
            data: { status: BroadcastStatus.SENDING, startedAt: new Date() },
          });
        }

        const caption = propertyCard({
          refCode: broadcast.property.refCode,
          dealType: broadcast.property.dealType,
          propertyType: broadcast.property.propertyType,
          priceSar: broadcast.property.priceSar,
          district: broadcast.property.district,
          city: broadcast.property.city,
          areaSqm: broadcast.property.areaSqm,
          bedrooms: broadcast.property.bedrooms,
          bathrooms: broadcast.property.bathrooms,
          features: broadcast.property.features,
          officeName: office.name,
          officePhone: office.whatsappDisplayNumber,
        });
        const body = `${broadcast.message ? `${broadcast.message}\n\n` : ''}${caption}\n\n${LEAD.footerOptOut}`;
        const cover = broadcast.property.media.find(
          (item) => item.type === MediaType.IMAGE && item.url,
        );

        for (const recipient of pending) {
          // Re-check immediately before sending: another broadcast may have
          // reached this customer since the plan was built.
          const decision = await this.antiSpam.check({
            officeId: office.id,
            timezone: office.timezone,
            settings,
            lead: recipient.lead,
            propertyId: broadcast.propertyId,
          });
          if (!decision.allowed) {
            await this.markSkipped(recipient.id, decision.reason ?? SkipReason.NO_MATCH);
            continue;
          }

          const result = cover?.url
            ? await this.whatsapp.sendImage(
                office.whatsappPhoneNumberId!,
                recipient.lead.waId,
                cover.url,
                body,
              )
            : await this.whatsapp.sendText(
                office.whatsappPhoneNumberId!,
                recipient.lead.waId,
                body,
              );

          if (result.ok) {
            await this.prisma.tenant.broadcastRecipient.update({
              where: { id: recipient.id },
              data: {
                status: DeliveryStatus.SENT,
                waMessageId: result.waMessageId,
                sentAt: new Date(),
                attempts: { increment: 1 },
              },
            });
            await this.antiSpam.recordDelivery({
              officeId: office.id,
              timezone: office.timezone,
              leadId: recipient.leadId,
              propertyId: broadcast.propertyId,
              broadcastId: broadcast.id,
            });
            await this.prisma.tenant.broadcast.update({
              where: { id: broadcast.id },
              data: { totalSent: { increment: 1 } },
            });
          } else {
            await this.prisma.tenant.broadcastRecipient.update({
              where: { id: recipient.id },
              data: {
                status: recipient.attempts >= 2 ? DeliveryStatus.FAILED : DeliveryStatus.PENDING,
                error: result.error,
                attempts: { increment: 1 },
              },
            });
            if (recipient.attempts >= 2) {
              await this.prisma.tenant.broadcast.update({
                where: { id: broadcast.id },
                data: { totalFailed: { increment: 1 } },
              });
            }
          }

          // Space the messages out inside the batch as well.
          await this.pause(60_000 / settings.broadcastRatePerMinute);
        }
      });
    }
  }

  private async markSkipped(recipientId: string, reason: SkipReason): Promise<void> {
    await this.prisma.tenant.broadcastRecipient.update({
      where: { id: recipientId },
      data: { status: DeliveryStatus.SKIPPED, skipReason: reason },
    });
  }

  private async complete(broadcastId: string): Promise<void> {
    await this.prisma.tenant.broadcast.update({
      where: { id: broadcastId },
      data: { status: BroadcastStatus.COMPLETED, completedAt: new Date() },
    });
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(ms, 50), 10_000)));
  }
}
