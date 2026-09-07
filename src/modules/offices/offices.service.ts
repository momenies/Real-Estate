import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Office, OfficeSettings, OfficeStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantStore } from '../../common/tenancy/tenant-context';
import { normalizeWaId } from '../../common/utils/phone.util';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

/** The guardrails an office is allowed to tune for itself. */
export type OfficeSettingsPatch = Partial<
  Pick<
    OfficeSettings,
    | 'dailyCapPerLead'
    | 'minHoursBetweenMessages'
    | 'quietHoursStart'
    | 'quietHoursEnd'
    | 'broadcastRatePerMinute'
    | 'autoSendLatestToNewLead'
    | 'latestCount'
    | 'draftWindowMinutes'
    | 'defaultCity'
  >
>;

export interface CreateOfficeInput {
  name: string;
  ownerName: string;
  ownerPhone: string;
  city?: string;
  whatsappPhoneNumberId?: string;
  whatsappDisplayNumber?: string;
  wabaId?: string;
  slug?: string;
}

@Injectable()
export class OfficesService {
  private readonly logger = new Logger(OfficesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * Onboarding an office is a single transaction: the tenant row, its
   * guardrail settings, the owner's WhatsApp identity, and the three-month
   * free trial that makes the pitch work.
   */
  async createOffice(input: CreateOfficeInput): Promise<Office> {
    const slug = input.slug ?? this.buildSlug(input.name);
    const ownerWaId = normalizeWaId(input.ownerPhone);

    return this.prisma.$transaction(async (tx) => {
      const office = await tx.office.create({
        data: {
          name: input.name,
          slug,
          city: input.city,
          ownerName: input.ownerName,
          status: OfficeStatus.ACTIVE,
          whatsappPhoneNumberId: input.whatsappPhoneNumberId,
          whatsappDisplayNumber: input.whatsappDisplayNumber,
          wabaId: input.wabaId,
          settings: { create: { defaultCity: input.city } },
        },
      });

      await tx.user.create({
        data: {
          officeId: office.id,
          name: input.ownerName,
          role: UserRole.OFFICE_OWNER,
          phone: ownerWaId,
          waId: ownerWaId,
        },
      });

      await this.subscriptions.startTrial(office.id, tx);

      this.logger.log(`Office "${office.name}" onboarded with a free trial (${office.id})`);
      return office;
    });
  }

  /** Routes an inbound WhatsApp webhook to the office that owns the number. */
  async findByWhatsappPhoneNumberId(phoneNumberId: string) {
    return this.prisma.office.findUnique({
      where: { whatsappPhoneNumberId: phoneNumberId },
      include: { settings: true, subscription: true },
    });
  }

  async getSettings(officeId: string): Promise<OfficeSettings> {
    const settings = await TenantStore.runAsOffice(officeId, () =>
      this.prisma.tenant.officeSettings.findUnique({ where: { officeId } }),
    );
    if (settings) return settings;
    // An office created before a settings row existed still gets defaults.
    return TenantStore.runAsOffice(officeId, () =>
      this.prisma.tenant.officeSettings.create({ data: { officeId } }),
    );
  }

  async updateSettings(
    officeId: string,
    data: OfficeSettingsPatch,
  ): Promise<OfficeSettings> {
    await this.getSettings(officeId);
    return TenantStore.runAsOffice(officeId, () =>
      this.prisma.tenant.officeSettings.update({
        where: { officeId },
        data: {
          dailyCapPerLead: data.dailyCapPerLead,
          minHoursBetweenMessages: data.minHoursBetweenMessages,
          quietHoursStart: data.quietHoursStart,
          quietHoursEnd: data.quietHoursEnd,
          broadcastRatePerMinute: data.broadcastRatePerMinute,
          autoSendLatestToNewLead: data.autoSendLatestToNewLead,
          latestCount: data.latestCount,
          draftWindowMinutes: data.draftWindowMinutes,
          defaultCity: data.defaultCity,
        },
      }),
    );
  }

  async findOwner(officeId: string) {
    return TenantStore.runAsOffice(officeId, () =>
      this.prisma.tenant.user.findFirst({
        where: { officeId, role: UserRole.OFFICE_OWNER, isActive: true },
      }),
    );
  }

  async isOfficeMember(officeId: string, waId: string): Promise<boolean> {
    const member = await TenantStore.runAsOffice(officeId, () =>
      this.prisma.tenant.user.findFirst({ where: { officeId, waId, isActive: true } }),
    );
    return member !== null;
  }

  async getOrThrow(officeId: string): Promise<Office> {
    const office = await this.prisma.office.findUnique({ where: { id: officeId } });
    if (!office) throw new NotFoundException(`Office ${officeId} not found`);
    return office;
  }

  private buildSlug(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9؀-ۿ]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `${base || 'office'}-${Math.random().toString(36).slice(2, 7)}`;
  }
}
