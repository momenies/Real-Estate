import { Injectable } from '@nestjs/common';
import { Lead, LeadIntent, LeadStatus, Prisma, PropertyType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { addDays } from '../../common/utils/time.util';
import { normalizeWaId } from '../../common/utils/phone.util';

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(officeId: string, waId: string, name?: string): Promise<Lead> {
    const normalized = normalizeWaId(waId);
    const existing = await this.prisma.tenant.lead.findUnique({
      where: { officeId_waId: { officeId, waId: normalized } },
    });
    if (existing) {
      return this.prisma.tenant.lead.update({
        where: { id: existing.id },
        data: {
          lastActiveAt: new Date(),
          lastMessageAt: new Date(),
          ...(name && !existing.name ? { name } : {}),
        },
      });
    }
    return this.prisma.tenant.lead.create({
      data: {
        officeId,
        waId: normalized,
        phone: normalized,
        name,
        status: LeadStatus.NEW,
        lastActiveAt: new Date(),
        lastMessageAt: new Date(),
      },
    });
  }

  async update(leadId: string, data: Prisma.LeadUpdateInput): Promise<Lead> {
    return this.prisma.tenant.lead.update({ where: { id: leadId }, data });
  }

  /**
   * Marks the moment a customer expressed what they are looking for. This
   * timestamp - not merely "last seen" - is what the owner means by
   * "send it to everyone who searched this month".
   */
  async recordSearch(leadId: string, patch: Prisma.LeadUpdateInput = {}): Promise<Lead> {
    return this.prisma.tenant.lead.update({
      where: { id: leadId },
      data: { ...patch, lastSearchAt: new Date(), status: LeadStatus.ACTIVE },
    });
  }

  async setIntent(leadId: string, intent: LeadIntent): Promise<Lead> {
    return this.recordSearch(leadId, { intent });
  }

  async addPropertyType(lead: Lead, propertyType: PropertyType): Promise<Lead> {
    const types = Array.from(new Set([...lead.propertyTypes, propertyType]));
    return this.recordSearch(lead.id, { propertyTypes: types });
  }

  async addDistrict(lead: Lead, district: string): Promise<Lead> {
    const districts = Array.from(new Set([...lead.districts, district]));
    return this.recordSearch(lead.id, { districts });
  }

  async setBudget(leadId: string, min: number | null, max: number | null): Promise<Lead> {
    return this.recordSearch(leadId, { budgetMin: min, budgetMax: max });
  }

  async optOut(leadId: string): Promise<Lead> {
    return this.prisma.tenant.lead.update({
      where: { id: leadId },
      data: { optedOut: true, optedOutAt: new Date() },
    });
  }

  async optIn(leadId: string): Promise<Lead> {
    return this.prisma.tenant.lead.update({
      where: { id: leadId },
      data: { optedOut: false, optedOutAt: null },
    });
  }

  /**
   * The audience for a broadcast: customers who searched inside the window the
   * owner picked (last day / week / month), optionally narrowed to those whose
   * stated preferences actually fit the property.
   */
  async findAudience(
    officeId: string,
    windowDays: number,
    match?: { propertyType?: PropertyType; district?: string | null; priceSar?: number | null },
  ): Promise<Lead[]> {
    const since = addDays(new Date(), -windowDays);
    const where: Prisma.LeadWhereInput = {
      officeId,
      optedOut: false,
      OR: [{ lastSearchAt: { gte: since } }, { createdAt: { gte: since } }],
    };

    const leads = await this.prisma.tenant.lead.findMany({
      where,
      orderBy: { lastSearchAt: 'desc' },
    });
    if (!match) return leads;

    // Preference matching is deliberately forgiving: a lead who never stated a
    // district still counts, because silence is not a rejection.
    return leads.filter((lead) => {
      if (match.propertyType && lead.propertyTypes.length) {
        if (!lead.propertyTypes.includes(match.propertyType)) return false;
      }
      if (match.district && lead.districts.length) {
        const wanted = lead.districts.some(
          (district) => match.district!.includes(district) || district.includes(match.district!),
        );
        if (!wanted) return false;
      }
      if (match.priceSar !== null && match.priceSar !== undefined) {
        if (lead.budgetMax !== null && match.priceSar > lead.budgetMax * 1.15) return false;
        if (lead.budgetMin !== null && match.priceSar < lead.budgetMin * 0.85) return false;
      }
      return true;
    });
  }

  async countByOffice(officeId: string) {
    const [total, active, optedOut] = await Promise.all([
      this.prisma.tenant.lead.count({ where: { officeId } }),
      this.prisma.tenant.lead.count({
        where: { officeId, lastSearchAt: { gte: addDays(new Date(), -30) } },
      }),
      this.prisma.tenant.lead.count({ where: { officeId, optedOut: true } }),
    ]);
    return { total, activeLast30Days: active, optedOut };
  }

  async list(officeId: string, take = 50, skip = 0) {
    return this.prisma.tenant.lead.findMany({
      where: { officeId },
      orderBy: { lastActiveAt: 'desc' },
      take,
      skip,
    });
  }
}
