import { Injectable } from '@nestjs/common';
import { PropertyStatus, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantStore } from '../../common/tenancy/tenant-context';
import { addDays } from '../../common/utils/time.util';

/**
 * The whole point of one central database.
 *
 * Each office sees only itself; the platform owner sees the network - every
 * property and every customer across every office, in one place. This is the
 * asset the SaaS is quietly building.
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async networkOverview() {
    return TenantStore.runAsSuperAdmin(async () => {
      const [offices, properties, leads, broadcasts, subscriptions] = await Promise.all([
        this.prisma.office.count(),
        this.prisma.property.count({ where: { status: PropertyStatus.PUBLISHED } }),
        this.prisma.lead.count(),
        this.prisma.broadcast.count(),
        this.prisma.subscription.groupBy({ by: ['status'], _count: { _all: true } }),
      ]);

      const activeLeads = await this.prisma.lead.count({
        where: { lastSearchAt: { gte: addDays(new Date(), -30) } },
      });
      const deliveries = await this.prisma.propertyDelivery.count();

      return {
        offices,
        publishedProperties: properties,
        leads,
        activeLeadsLast30Days: activeLeads,
        broadcasts,
        propertyDeliveries: deliveries,
        subscriptionsByStatus: Object.fromEntries(
          subscriptions.map((row) => [row.status, row._count._all]),
        ),
      };
    });
  }

  async officesTable() {
    return TenantStore.runAsSuperAdmin(() =>
      this.prisma.office.findMany({
        include: {
          subscription: true,
          settings: true,
          _count: { select: { properties: true, leads: true, broadcasts: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  /** Cross-office inventory search - available to the super admin only. */
  async searchProperties(params: {
    query?: string;
    officeId?: string;
    district?: string;
    minPrice?: number;
    maxPrice?: number;
    take?: number;
    skip?: number;
  }) {
    return TenantStore.runAsSuperAdmin(() =>
      this.prisma.property.findMany({
        where: {
          status: PropertyStatus.PUBLISHED,
          ...(params.officeId ? { officeId: params.officeId } : {}),
          ...(params.district
            ? { district: { contains: params.district, mode: 'insensitive' as const } }
            : {}),
          ...(params.minPrice || params.maxPrice
            ? {
                priceSar: {
                  ...(params.minPrice ? { gte: params.minPrice } : {}),
                  ...(params.maxPrice ? { lte: params.maxPrice } : {}),
                },
              }
            : {}),
          ...(params.query
            ? {
                OR: [
                  { refCode: { contains: params.query, mode: 'insensitive' as const } },
                  { district: { contains: params.query, mode: 'insensitive' as const } },
                  { rawText: { contains: params.query, mode: 'insensitive' as const } },
                ],
              }
            : {}),
        },
        include: { office: { select: { id: true, name: true, city: true } } },
        orderBy: { publishedAt: 'desc' },
        take: params.take ?? 50,
        skip: params.skip ?? 0,
      }),
    );
  }

  /** The aggregated demand signal: what customers across the network want. */
  async demandInsights() {
    return TenantStore.runAsSuperAdmin(async () => {
      const [byType, byCity, recent] = await Promise.all([
        this.prisma.property.groupBy({
          by: ['propertyType'],
          _count: { _all: true },
          _avg: { priceSar: true },
          where: { status: PropertyStatus.PUBLISHED },
        }),
        this.prisma.property.groupBy({
          by: ['city'],
          _count: { _all: true },
          where: { status: PropertyStatus.PUBLISHED, city: { not: null } },
        }),
        this.prisma.lead.groupBy({
          by: ['intent'],
          _count: { _all: true },
          where: { lastSearchAt: { gte: addDays(new Date(), -30) } },
        }),
      ]);

      return {
        supplyByPropertyType: byType.map((row) => ({
          propertyType: row.propertyType,
          count: row._count._all,
          averagePriceSar: row._avg.priceSar ? Math.round(row._avg.priceSar) : null,
        })),
        supplyByCity: byCity.map((row) => ({ city: row.city, count: row._count._all })),
        demandByIntentLast30Days: recent.map((row) => ({
          intent: row.intent,
          count: row._count._all,
        })),
      };
    });
  }

  async expiringSubscriptions(withinDays = 14) {
    return TenantStore.runAsSuperAdmin(() =>
      this.prisma.subscription.findMany({
        where: {
          status: { in: [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE] },
          OR: [
            { trialEndsAt: { lte: addDays(new Date(), withinDays) } },
            { currentPeriodEnd: { lte: addDays(new Date(), withinDays) } },
          ],
        },
        include: { office: { select: { id: true, name: true, city: true } } },
        orderBy: { trialEndsAt: 'asc' },
      }),
    );
  }
}
