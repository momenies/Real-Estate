import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DealType,
  MediaType,
  Prisma,
  Property,
  PropertyStatus,
  PropertyType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { parseProperty } from '../../common/utils/property-parser';
import { buildRefCode } from '../../common/utils/ref-code.util';

export interface DraftMediaInput {
  type: MediaType;
  waMediaId?: string;
  storageKey?: string;
  url?: string;
  mimeType?: string;
  sizeBytes?: number;
  caption?: string;
}

@Injectable()
export class PropertiesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The draft is what makes the owner's experience effortless: photos, a video,
   * a price and a location pin arrive as separate WhatsApp messages over a few
   * minutes, and all of them land on the same property.
   */
  async getOpenDraft(officeId: string, userId: string | null): Promise<Property | null> {
    return this.prisma.tenant.property.findFirst({
      where: {
        officeId,
        status: PropertyStatus.DRAFT,
        createdById: userId,
        draftExpiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createDraft(
    officeId: string,
    userId: string | null,
    draftWindowMinutes: number,
  ): Promise<Property> {
    return this.prisma.tenant.property.create({
      data: {
        officeId,
        createdById: userId,
        refCode: await this.nextRefCode(officeId, PropertyType.OTHER, DealType.UNKNOWN),
        status: PropertyStatus.DRAFT,
        draftExpiresAt: new Date(Date.now() + draftWindowMinutes * 60_000),
      },
    });
  }

  async extendDraftWindow(propertyId: string, draftWindowMinutes: number): Promise<void> {
    await this.prisma.tenant.property.update({
      where: { id: propertyId },
      data: { draftExpiresAt: new Date(Date.now() + draftWindowMinutes * 60_000) },
    });
  }

  /**
   * Merges newly parsed text into a draft without ever overwriting something
   * the owner already stated - later corrections come through `applyEdit`.
   */
  async mergeParsedText(property: Property, rawText: string): Promise<Property> {
    const parsed = parseProperty(rawText);
    const data: Prisma.PropertyUpdateInput = {
      rawText: [property.rawText, rawText].filter(Boolean).join('\n'),
    };

    if (property.dealType === DealType.UNKNOWN && parsed.dealType !== DealType.UNKNOWN) {
      data.dealType = parsed.dealType;
    }
    if (
      property.propertyType === PropertyType.OTHER &&
      parsed.propertyType !== PropertyType.OTHER
    ) {
      data.propertyType = parsed.propertyType;
    }
    if (property.priceSar === null && parsed.priceSar !== null) data.priceSar = parsed.priceSar;
    if (!property.district && parsed.district) data.district = parsed.district;
    if (!property.city && parsed.city) data.city = parsed.city;
    if (property.areaSqm === null && parsed.areaSqm !== null) data.areaSqm = parsed.areaSqm;
    if (property.bedrooms === null && parsed.bedrooms !== null) data.bedrooms = parsed.bedrooms;
    if (property.bathrooms === null && parsed.bathrooms !== null) data.bathrooms = parsed.bathrooms;
    if (property.floors === null && parsed.floors !== null) data.floors = parsed.floors;
    if (property.ageYears === null && parsed.ageYears !== null) data.ageYears = parsed.ageYears;
    if (parsed.features.length) {
      data.features = Array.from(new Set([...property.features, ...parsed.features]));
    }

    return this.prisma.tenant.property.update({ where: { id: property.id }, data });
  }

  /** A correction ("السعر 950 الف") overwrites whatever was there before. */
  async applyEdit(property: Property, rawText: string): Promise<Property> {
    const parsed = parseProperty(rawText);
    const data: Prisma.PropertyUpdateInput = {};
    if (parsed.priceSar !== null) data.priceSar = parsed.priceSar;
    if (parsed.district) data.district = parsed.district;
    if (parsed.city) data.city = parsed.city;
    if (parsed.dealType !== DealType.UNKNOWN) data.dealType = parsed.dealType;
    if (parsed.propertyType !== PropertyType.OTHER) data.propertyType = parsed.propertyType;
    if (parsed.areaSqm !== null) data.areaSqm = parsed.areaSqm;
    if (parsed.bedrooms !== null) data.bedrooms = parsed.bedrooms;
    if (parsed.bathrooms !== null) data.bathrooms = parsed.bathrooms;
    if (Object.keys(data).length === 0) return property;
    return this.prisma.tenant.property.update({ where: { id: property.id }, data });
  }

  async setLocation(
    propertyId: string,
    latitude: number,
    longitude: number,
    name?: string,
  ): Promise<Property> {
    return this.prisma.tenant.property.update({
      where: { id: propertyId },
      data: { latitude, longitude, locationName: name },
    });
  }

  async addMedia(officeId: string, propertyId: string, media: DraftMediaInput) {
    const count = await this.prisma.tenant.propertyMedia.count({ where: { propertyId } });
    return this.prisma.tenant.propertyMedia.create({
      data: {
        officeId,
        propertyId,
        type: media.type,
        waMediaId: media.waMediaId,
        storageKey: media.storageKey,
        url: media.url,
        mimeType: media.mimeType,
        sizeBytes: media.sizeBytes,
        caption: media.caption,
        sortOrder: count,
      },
    });
  }

  async countMedia(propertyId: string): Promise<number> {
    return this.prisma.tenant.propertyMedia.count({ where: { propertyId } });
  }

  async getMedia(propertyId: string) {
    return this.prisma.tenant.propertyMedia.findMany({
      where: { propertyId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** Fields the bot must have before an offer is worth publishing. */
  missingFields(property: Property): string[] {
    return [
      property.priceSar === null ? 'price' : null,
      !property.district ? 'district' : null,
      property.dealType === DealType.UNKNOWN ? 'dealType' : null,
      property.propertyType === PropertyType.OTHER ? 'propertyType' : null,
    ].filter((field): field is string => field !== null);
  }

  async publish(officeId: string, propertyId: string): Promise<Property> {
    const property = await this.getOrThrow(propertyId);
    // The ref code encodes type and deal, both of which may have changed while
    // the draft was being filled in.
    const refCode = await this.nextRefCode(officeId, property.propertyType, property.dealType);
    return this.prisma.tenant.property.update({
      where: { id: propertyId },
      data: {
        status: PropertyStatus.PUBLISHED,
        publishedAt: new Date(),
        draftExpiresAt: null,
        refCode,
        title: this.buildTitle(property),
      },
    });
  }

  async archive(propertyId: string): Promise<Property> {
    return this.prisma.tenant.property.update({
      where: { id: propertyId },
      data: { status: PropertyStatus.ARCHIVED },
    });
  }

  async getOrThrow(propertyId: string): Promise<Property> {
    const property = await this.prisma.tenant.property.findUnique({ where: { id: propertyId } });
    if (!property) throw new NotFoundException(`Property ${propertyId} not found`);
    return property;
  }

  /** Looks a property up by the short code the owner says out loud. */
  async findByRefCode(officeId: string, refCode: string) {
    return this.prisma.tenant.property.findFirst({
      where: { officeId, refCode: { equals: refCode, mode: 'insensitive' } },
    });
  }

  async findLatestPublished(officeId: string) {
    return this.prisma.tenant.property.findFirst({
      where: { officeId, status: PropertyStatus.PUBLISHED },
      orderBy: { publishedAt: 'desc' },
    });
  }

  async findPublished(officeId: string, take = 20, skip = 0) {
    return this.prisma.tenant.property.findMany({
      where: { officeId, status: PropertyStatus.PUBLISHED },
      orderBy: { publishedAt: 'desc' },
      include: { media: { orderBy: { sortOrder: 'asc' }, take: 1 } },
      take,
      skip,
    });
  }

  /** "آخر الموجود" for a newly-registered customer, narrowed by what they asked for. */
  async findMatchesForLead(
    officeId: string,
    criteria: {
      propertyTypes?: PropertyType[];
      districts?: string[];
      budgetMin?: number | null;
      budgetMax?: number | null;
      dealType?: DealType | null;
    },
    take = 3,
  ) {
    const where: Prisma.PropertyWhereInput = {
      officeId,
      status: PropertyStatus.PUBLISHED,
    };
    if (criteria.propertyTypes?.length) where.propertyType = { in: criteria.propertyTypes };
    if (criteria.districts?.length) {
      where.OR = criteria.districts.map((district) => ({
        district: { contains: district, mode: 'insensitive' as const },
      }));
    }
    if (criteria.dealType) where.dealType = criteria.dealType;
    if (criteria.budgetMax) where.priceSar = { lte: criteria.budgetMax };
    if (criteria.budgetMin) {
      where.priceSar = { ...(where.priceSar as object), gte: criteria.budgetMin };
    }

    return this.prisma.tenant.property.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      take,
    });
  }

  private buildTitle(property: Property): string {
    const parts = [property.propertyType, property.dealType, property.district].filter(Boolean);
    return parts.join(' - ');
  }

  /**
   * Sequence is per office, so two offices can both hold FL-004 without
   * colliding. Retries on the unique constraint rather than locking a counter.
   */
  private async nextRefCode(
    officeId: string,
    propertyType: PropertyType,
    dealType: DealType,
  ): Promise<string> {
    const count = await this.prisma.tenant.property.count({ where: { officeId } });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = buildRefCode(propertyType, dealType, count + 1 + attempt);
      const taken = await this.prisma.tenant.property.findFirst({
        where: { officeId, refCode: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    return buildRefCode(propertyType, dealType, Date.now() % 100_000);
  }
}
