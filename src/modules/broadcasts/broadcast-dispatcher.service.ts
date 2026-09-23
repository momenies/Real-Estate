import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  BroadcastStatus,
  DealType,
  DeliveryStatus,
  MediaType,
  OfficeStatus,
  PropertyType,
  SkipReason,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantStore } from '../../common/tenancy/tenant-context';
import { isWithinQuietHours, isWithinServiceWindow } from '../../common/utils/time.util';
import {
  LEAD,
  PROPERTY_REPLY_PREFIX,
  formatSar,
  propertyCard,
  propertyTeaser,
  templateParam,
} from '../whatsapp/messages';
import { SendResult, WhatsappApiService } from '../whatsapp/whatsapp-api.service';
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
    private readonly config?: ConfigService,
  ) {}

  private get enabled(): boolean {
    // Default on: a missing ConfigService means a direct instantiation in a test.
    return this.config?.get<boolean>('workersEnabled') ?? true;
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick(): Promise<void> {
    if (!this.enabled) return;
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

      // Suspension has to stop outbound traffic, not only inbound. Otherwise
      // suspending an office silences its bot while its queued broadcast keeps
      // reaching customers - the worst of both.
      if (office.status !== OfficeStatus.ACTIVE) {
        this.logger.warn(`Office ${office.id} is ${office.status}; broadcast ${broadcast.id} held`);
        continue;
      }

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

          // The rule that decides HOW to send, after anti-spam has decided
          // WHETHER to. A customer who searched three weeks ago - precisely the
          // audience of "أرسلها لعملاء آخر شهر" - is outside Meta's 24-hour
          // window, and a free-form send to them fails with error 131047. Only
          // an approved template reaches them.
          const result = isWithinServiceWindow(recipient.lead.lastMessageAt)
            ? cover?.url
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
                )
            : await this.sendOutsideWindow(broadcast, office, settings, recipient.lead.waId);

          if (result === null) {
            // No template configured: skipping is the honest outcome. Sending
            // anyway would burn an attempt, log a Meta error, and still deliver
            // nothing - and the owner would believe the offer went out.
            await this.markSkipped(recipient.id, SkipReason.OUTSIDE_24H_WINDOW);
            continue;
          }

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

  /**
   * Reaches a customer whose service window has closed, using the office's
   * approved template. Returns null when no template is configured, which the
   * caller records as OUTSIDE_24H_WINDOW.
   *
   * The quick-reply button carries the property's ref code, so the customer's
   * tap both reopens the 24-hour window and tells the bot which offer to send
   * in full - photo, card and location.
   */
  private async sendOutsideWindow(
    broadcast: {
      property: {
        refCode: string;
        dealType: DealType;
        propertyType: PropertyType;
        priceSar: number | null;
        district: string | null;
        city: string | null;
        areaSqm: number | null;
        bedrooms: number | null;
      };
    },
    office: { name: string; whatsappPhoneNumberId: string | null },
    settings: { broadcastTemplateName: string | null; broadcastTemplateLanguage: string },
    waId: string,
  ): Promise<SendResult | null> {
    // `||`, not `??`: an office whose template field was cleared in the
    // dashboard holds an empty string, and that should fall through to the
    // platform default rather than disable templates for that office alone.
    const templateName =
      settings.broadcastTemplateName ||
      this.config?.get<string>('whatsapp.broadcastTemplate') ||
      '';
    if (!templateName) return null;

    const language =
      settings.broadcastTemplateLanguage ||
      this.config?.get<string>('whatsapp.broadcastTemplateLanguage') ||
      'ar';

    return this.whatsapp.sendTemplate(office.whatsappPhoneNumberId!, waId, templateName, language, [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: templateParam(office.name) },
          { type: 'text', text: propertyTeaser(broadcast.property) },
          { type: 'text', text: templateParam(formatSar(broadcast.property.priceSar)) },
        ],
      },
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: '0',
        parameters: [
          { type: 'payload', payload: `${PROPERTY_REPLY_PREFIX}:${broadcast.property.refCode}` },
        ],
      },
    ]);
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
