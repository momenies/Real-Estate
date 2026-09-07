import { Injectable } from '@nestjs/common';
import { Lead, OfficeSettings, SkipReason } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { hoursSince, isWithinQuietHours, officeDayKey } from '../../common/utils/time.util';

export interface DeliveryCheck {
  allowed: boolean;
  reason?: SkipReason;
}

export interface AntiSpamInput {
  officeId: string;
  timezone: string;
  settings: Pick<
    OfficeSettings,
    'dailyCapPerLead' | 'minHoursBetweenMessages' | 'quietHoursStart' | 'quietHoursEnd'
  >;
  lead: Pick<Lead, 'id' | 'optedOut' | 'lastBroadcastAt' | 'waId'>;
  propertyId: string;
  now?: Date;
}

/**
 * The rules that decide whether one particular message may go to one
 * particular customer.
 *
 * These exist for two reasons at once: the customer should not be annoyed, and
 * a number that annoys people gets reported and then banned by Meta. Protecting
 * the office's WhatsApp number is protecting the whole business.
 */
@Injectable()
export class AntiSpamService {
  constructor(private readonly prisma: PrismaService) {}

  async check(input: AntiSpamInput): Promise<DeliveryCheck> {
    const now = input.now ?? new Date();
    const { settings, lead } = input;

    // Order matters. Eligibility rules ("should this customer ever get this
    // message?") are all evaluated before quiet hours, which is merely a
    // question of timing. Checking quiet hours first would mask a duplicate as
    // a deferral, and the caller would queue a message it should have dropped.
    if (lead.optedOut) {
      return { allowed: false, reason: SkipReason.OPTED_OUT };
    }

    // Never send the same property to the same customer twice - the single
    // most visible form of spam, and the easiest to prevent.
    const alreadyReceived = await this.prisma.tenant.propertyDelivery.findUnique({
      where: { propertyId_leadId: { propertyId: input.propertyId, leadId: lead.id } },
      select: { id: true },
    });
    if (alreadyReceived) {
      return { allowed: false, reason: SkipReason.ALREADY_RECEIVED_PROPERTY };
    }

    const day = officeDayKey(input.timezone, now);
    const quota = await this.prisma.tenant.leadDailyQuota.findUnique({
      where: { leadId_day: { leadId: lead.id, day } },
      select: { sentCount: true },
    });
    if ((quota?.sentCount ?? 0) >= settings.dailyCapPerLead) {
      return { allowed: false, reason: SkipReason.DAILY_CAP_REACHED };
    }

    if (hoursSince(lead.lastBroadcastAt, now) < settings.minHoursBetweenMessages) {
      return { allowed: false, reason: SkipReason.COOLDOWN_ACTIVE };
    }

    // Eligible, but possibly not right now: the caller may hold this recipient
    // and send once the quiet window closes.
    if (
      isWithinQuietHours(input.timezone, settings.quietHoursStart, settings.quietHoursEnd, now)
    ) {
      return { allowed: false, reason: SkipReason.QUIET_HOURS };
    }

    return { allowed: true };
  }

  /**
   * Records a successful send. Written in one transaction with the delivery
   * ledger so a crash can never leave the dedup record missing while the
   * customer has already received the message.
   */
  async recordDelivery(params: {
    officeId: string;
    timezone: string;
    leadId: string;
    propertyId: string;
    broadcastId?: string | null;
    channel?: string;
    now?: Date;
  }): Promise<void> {
    const now = params.now ?? new Date();
    const day = officeDayKey(params.timezone, now);

    await this.prisma.$transaction([
      this.prisma.propertyDelivery.create({
        data: {
          officeId: params.officeId,
          propertyId: params.propertyId,
          leadId: params.leadId,
          broadcastId: params.broadcastId ?? null,
          channel: params.channel ?? 'broadcast',
          sentAt: now,
        },
      }),
      this.prisma.leadDailyQuota.upsert({
        where: { leadId_day: { leadId: params.leadId, day } },
        create: { officeId: params.officeId, leadId: params.leadId, day, sentCount: 1 },
        update: { sentCount: { increment: 1 } },
      }),
      this.prisma.lead.update({
        where: { id: params.leadId },
        data: { lastBroadcastAt: now },
      }),
    ]);
  }
}
