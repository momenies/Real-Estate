import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExternalPlatform, MediaType, PublicationStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PropertiesService } from '../properties/properties.service';
import { OfficesService } from '../offices/offices.service';
import { DEAL_LABELS, TYPE_LABELS, formatSar } from '../whatsapp/messages';

const SHARE_TTL_DAYS = 14;

/**
 * Haraj "smart copy-paste".
 *
 * Haraj has no partner API, and posting through automation is what gets an
 * account banned there. So the platform stops one step short on purpose: it
 * writes the listing, orders the photos, and hands the owner a page where the
 * title, body and images are one tap from the clipboard. A human still presses
 * publish - which is both the safe path and the compliant one.
 */
@Injectable()
export class HarajService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly properties: PropertiesService,
    private readonly offices: OfficesService,
  ) {}

  async preparePackage(officeId: string, propertyId: string) {
    const property = await this.properties.getOrThrow(propertyId);
    const media = await this.properties.getMedia(propertyId);
    const office = await this.offices.getOrThrow(officeId);

    const title = this.buildTitle(property);
    const body = this.buildBody(property, office.name, office.whatsappDisplayNumber);
    const shareToken = randomBytes(16).toString('base64url');

    const publication = await this.prisma.externalPublication.create({
      data: {
        officeId,
        propertyId,
        platform: ExternalPlatform.HARAJ,
        status: PublicationStatus.PREPARED,
        caption: title,
        payload: {
          title,
          body,
          images: media
            .filter((item) => item.type === MediaType.IMAGE && item.url)
            .map((item) => item.url),
          videos: media
            .filter((item) => item.type === MediaType.VIDEO && item.url)
            .map((item) => item.url),
          location:
            property.latitude !== null && property.longitude !== null
              ? {
                  latitude: property.latitude,
                  longitude: property.longitude,
                  mapUrl: `https://maps.google.com/?q=${property.latitude},${property.longitude}`,
                }
              : null,
        },
        shareToken,
        shareExpiresAt: new Date(Date.now() + SHARE_TTL_DAYS * 86_400_000),
      },
    });

    return {
      publication,
      shareUrl: `${this.config.get<string>('publicUrl')}/share/haraj/${shareToken}`,
    };
  }

  /** Public, unauthenticated read - the token is the credential. */
  async getByShareToken(token: string) {
    const publication = await this.prisma.externalPublication.findUnique({
      where: { shareToken: token },
      include: { property: true, office: { select: { name: true } } },
    });
    if (!publication) throw new NotFoundException('Listing package not found');
    if (publication.shareExpiresAt && publication.shareExpiresAt < new Date()) {
      throw new NotFoundException('This listing package has expired');
    }
    return publication;
  }

  /** The owner tells us where they posted it, so the record stays complete. */
  async recordPosted(publicationId: string, url: string) {
    return this.prisma.externalPublication.update({
      where: { id: publicationId },
      data: { status: PublicationStatus.PUBLISHED, url, publishedAt: new Date() },
    });
  }

  private buildTitle(property: {
    propertyType: keyof typeof TYPE_LABELS;
    dealType: keyof typeof DEAL_LABELS;
    district: string | null;
    city: string | null;
    bedrooms: number | null;
  }): string {
    return [
      TYPE_LABELS[property.propertyType],
      DEAL_LABELS[property.dealType],
      property.district ? `حي ${property.district}` : '',
      property.city ?? '',
      property.bedrooms ? `${property.bedrooms} غرف` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  private buildBody(
    property: {
      propertyType: keyof typeof TYPE_LABELS;
      dealType: keyof typeof DEAL_LABELS;
      district: string | null;
      city: string | null;
      priceSar: number | null;
      areaSqm: number | null;
      bedrooms: number | null;
      bathrooms: number | null;
      floors: number | null;
      ageYears: number | null;
      features: string[];
      refCode: string;
      latitude: number | null;
      longitude: number | null;
    },
    officeName: string,
    officePhone: string | null,
  ): string {
    const lines = [
      `${TYPE_LABELS[property.propertyType]} ${DEAL_LABELS[property.dealType]}`,
      property.district ? `الحي: ${property.district}` : '',
      property.city ? `المدينة: ${property.city}` : '',
      `السعر: ${formatSar(property.priceSar)}`,
      property.areaSqm ? `المساحة: ${property.areaSqm} م²` : '',
      property.bedrooms ? `عدد الغرف: ${property.bedrooms}` : '',
      property.bathrooms ? `دورات المياه: ${property.bathrooms}` : '',
      property.floors ? `عدد الأدوار: ${property.floors}` : '',
      property.ageYears ? `عمر العقار: ${property.ageYears} سنة` : '',
      property.features.length ? `المميزات: ${property.features.join(' - ')}` : '',
      property.latitude !== null && property.longitude !== null
        ? `الموقع: https://maps.google.com/?q=${property.latitude},${property.longitude}`
        : '',
      '',
      `رقم العرض: ${property.refCode}`,
      officeName,
      officePhone ? `للتواصل: ${officePhone}` : '',
    ];
    return lines.filter(Boolean).join('\n');
  }
}
