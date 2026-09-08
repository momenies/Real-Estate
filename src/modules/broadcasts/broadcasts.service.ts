import { Injectable, Logger } from '@nestjs/common';
import { Broadcast, BroadcastStatus, DeliveryStatus, Property, SkipReason } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LeadsService } from '../leads/leads.service';
import { OfficesService } from '../offices/offices.service';
import { AntiSpamService } from './anti-spam.service';

export interface CreateBroadcastInput {
  officeId: string;
  propertyId: string;
  createdById?: string | null;
  audienceWindowDays: number;
  matchLeadPreferences?: boolean;
  message?: string;
}

export interface BroadcastPlan {
  broadcast: Broadcast;
  targeted: number;
  skipped: number;
  skipBreakdown: Partial<Record<SkipReason, number>>;
}

export const WINDOW_LABELS: Record<number, string> = {
  1: 'آخر يوم',
  7: 'آخر أسبوع',
  30: 'آخر شهر',
  90: 'آخر ٣ أشهر',
};

@Injectable()
export class BroadcastsService {
  private readonly logger = new Logger(BroadcastsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly offices: OfficesService,
    private readonly antiSpam: AntiSpamService,
  ) {}

  /**
   * Builds the recipient list up front rather than filtering at send time.
   *
   * Every exclusion is written down as a row with its reason, so the owner can
   * be told exactly why 40 customers became 12 - and so a retry never
   * re-evaluates a decision that was already made.
   */
  async plan(input: CreateBroadcastInput): Promise<BroadcastPlan> {
    const office = await this.offices.getOrThrow(input.officeId);
    const settings = await this.offices.getSettings(input.officeId);
    const property = await this.prisma.tenant.property.findUnique({
      where: { id: input.propertyId },
    });
    if (!property) throw new Error(`Property ${input.propertyId} not found`);

    const broadcast = await this.prisma.tenant.broadcast.create({
      data: {
        officeId: input.officeId,
        propertyId: input.propertyId,
        createdById: input.createdById ?? null,
        audienceWindowDays: input.audienceWindowDays,
        matchLeadPreferences: input.matchLeadPreferences ?? true,
        message: input.message,
        status: BroadcastStatus.DRAFT,
      },
    });

    const audience = await this.leads.findAudience(
      input.officeId,
      input.audienceWindowDays,
      input.matchLeadPreferences === false
        ? undefined
        : {
            propertyType: property.propertyType,
            district: property.district,
            priceSar: property.priceSar,
          },
    );

    const skipBreakdown: Partial<Record<SkipReason, number>> = {};
    let targeted = 0;
    let skipped = 0;

    for (const lead of audience) {
      const decision = await this.antiSpam.check({
        officeId: input.officeId,
        timezone: office.timezone,
        settings,
        lead,
        propertyId: input.propertyId,
      });

      // Quiet hours are a timing rule, not an exclusion: those recipients stay
      // pending and go out when the window opens.
      const isDeferrable = decision.reason === SkipReason.QUIET_HOURS;

      if (decision.allowed || isDeferrable) {
        targeted += 1;
        await this.prisma.tenant.broadcastRecipient.create({
          data: {
            officeId: input.officeId,
            broadcastId: broadcast.id,
            leadId: lead.id,
            status: DeliveryStatus.PENDING,
          },
        });
      } else {
        skipped += 1;
        skipBreakdown[decision.reason!] = (skipBreakdown[decision.reason!] ?? 0) + 1;
        await this.prisma.tenant.broadcastRecipient.create({
          data: {
            officeId: input.officeId,
            broadcastId: broadcast.id,
            leadId: lead.id,
            status: DeliveryStatus.SKIPPED,
            skipReason: decision.reason,
          },
        });
      }
    }

    const updated = await this.prisma.tenant.broadcast.update({
      where: { id: broadcast.id },
      data: {
        totalTargeted: targeted,
        totalSkipped: skipped,
        status: targeted > 0 ? BroadcastStatus.QUEUED : BroadcastStatus.COMPLETED,
        completedAt: targeted > 0 ? null : new Date(),
      },
    });

    this.logger.log(
      `Broadcast ${updated.id}: ${targeted} queued, ${skipped} skipped ` +
        `(${JSON.stringify(skipBreakdown)})`,
    );

    return { broadcast: updated, targeted, skipped, skipBreakdown };
  }

  /** The broadcast an owner means when he types «إلغاء الإرسال». */
  async findActive(officeId: string) {
    return this.prisma.tenant.broadcast.findFirst({
      where: {
        officeId,
        status: { in: [BroadcastStatus.QUEUED, BroadcastStatus.SENDING] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async countPending(broadcastId: string): Promise<number> {
    return this.prisma.tenant.broadcastRecipient.count({
      where: { broadcastId, status: DeliveryStatus.PENDING },
    });
  }

  async cancel(broadcastId: string): Promise<Broadcast> {
    await this.prisma.tenant.broadcastRecipient.updateMany({
      where: { broadcastId, status: DeliveryStatus.PENDING },
      data: { status: DeliveryStatus.SKIPPED, skipReason: SkipReason.NO_MATCH },
    });
    return this.prisma.tenant.broadcast.update({
      where: { id: broadcastId },
      data: { status: BroadcastStatus.CANCELED, completedAt: new Date() },
    });
  }

  async getWithProperty(broadcastId: string) {
    return this.prisma.tenant.broadcast.findUnique({
      where: { id: broadcastId },
      include: { property: { include: { media: { orderBy: { sortOrder: 'asc' } } } } },
    });
  }

  async list(officeId: string, take = 20) {
    return this.prisma.tenant.broadcast.findMany({
      where: { officeId },
      orderBy: { createdAt: 'desc' },
      include: { property: { select: { refCode: true, district: true, priceSar: true } } },
      take,
    });
  }

  async stats(broadcastId: string) {
    const grouped = await this.prisma.tenant.broadcastRecipient.groupBy({
      by: ['status'],
      where: { broadcastId },
      _count: { _all: true },
    });
    return grouped.reduce<Record<string, number>>((accumulator, row) => {
      accumulator[row.status] = row._count._all;
      return accumulator;
    }, {});
  }

  summarizeProperty(property: Property): string {
    return `${property.refCode} - ${property.district ?? ''} - ${property.priceSar ?? ''}`;
  }
}
