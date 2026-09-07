import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PlanCode,
  Prisma,
  Subscription,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantStore } from '../../common/tenancy/tenant-context';
import { addDays } from '../../common/utils/time.util';

export interface AccessDecision {
  allowed: boolean;
  status: SubscriptionStatus;
  daysRemaining: number;
  inTrial: boolean;
  reason?: string;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Three months free - the offer that gets a traditional office to try at all. */
  async startTrial(officeId: string, tx?: Prisma.TransactionClient): Promise<Subscription> {
    const client = tx ?? this.prisma;
    const trialDays = this.config.get<number>('trialDays') ?? 90;
    const now = new Date();

    const subscription = await client.subscription.create({
      data: {
        officeId,
        plan: PlanCode.TRIAL,
        status: SubscriptionStatus.TRIALING,
        trialStartsAt: now,
        trialEndsAt: addDays(now, trialDays),
        priceSar: 0,
      },
    });

    await client.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        type: 'trial_started',
        meta: { trialDays },
      },
    });

    return subscription;
  }

  async get(officeId: string): Promise<Subscription | null> {
    return this.prisma.subscription.findUnique({ where: { officeId } });
  }

  /**
   * Answers "may this office still write?".
   *
   * Reading and receiving messages never stops - an expired office keeps its
   * data and can still be reached. What stops is adding inventory and
   * broadcasting, which is what the subscription actually pays for.
   */
  async checkAccess(officeId: string, now: Date = new Date()): Promise<AccessDecision> {
    const subscription = await this.get(officeId);
    if (!subscription) {
      return {
        allowed: false,
        status: SubscriptionStatus.EXPIRED,
        daysRemaining: 0,
        inTrial: false,
        reason: 'no_subscription',
      };
    }

    const endsAt = this.effectiveEnd(subscription);
    const graceEnd = subscription.graceUntil ?? endsAt;
    const daysRemaining = Math.max(
      0,
      Math.ceil((endsAt.getTime() - now.getTime()) / 86_400_000),
    );
    const inTrial = subscription.status === SubscriptionStatus.TRIALING;

    if (subscription.status === SubscriptionStatus.CANCELED) {
      return { allowed: false, status: subscription.status, daysRemaining: 0, inTrial, reason: 'canceled' };
    }
    if (now <= endsAt) {
      return { allowed: true, status: subscription.status, daysRemaining, inTrial };
    }
    if (now <= graceEnd) {
      return {
        allowed: true,
        status: SubscriptionStatus.PAST_DUE,
        daysRemaining: 0,
        inTrial,
        reason: 'grace_period',
      };
    }
    return {
      allowed: false,
      status: SubscriptionStatus.EXPIRED,
      daysRemaining: 0,
      inTrial,
      reason: 'expired',
    };
  }

  /** Converts a trial (or renews a paid plan) for a number of months. */
  async activate(officeId: string, plan: PlanCode, months: number, priceSar: number) {
    const subscription = await this.get(officeId);
    if (!subscription) throw new Error(`Office ${officeId} has no subscription`);

    const now = new Date();
    const start = this.effectiveEnd(subscription) > now ? this.effectiveEnd(subscription) : now;
    const end = addDays(start, months * 30);

    const updated = await this.prisma.subscription.update({
      where: { officeId },
      data: {
        plan,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        graceUntil: addDays(end, this.config.get<number>('graceDays') ?? 7),
        priceSar,
        canceledAt: null,
      },
    });

    await this.prisma.subscriptionEvent.create({
      data: {
        subscriptionId: updated.id,
        type: 'activated',
        meta: { plan, months, priceSar },
      },
    });

    return updated;
  }

  async cancel(officeId: string, reason?: string) {
    const updated = await this.prisma.subscription.update({
      where: { officeId },
      data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
    });
    await this.prisma.subscriptionEvent.create({
      data: { subscriptionId: updated.id, type: 'canceled', meta: { reason } },
    });
    return updated;
  }

  /**
   * Subscriptions whose trial or paid period ends within `withinDays`.
   * Cross-office by design: this is platform bookkeeping, so it runs as the
   * super admin rather than pretending to be a tenant.
   */
  async findExpiring(withinDays: number) {
    return TenantStore.runAsSuperAdmin(() =>
      this.prisma.subscription.findMany({
        where: {
          status: { in: [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE] },
          OR: [
            { trialEndsAt: { lte: addDays(new Date(), withinDays) } },
            { currentPeriodEnd: { lte: addDays(new Date(), withinDays) } },
          ],
        },
        include: { office: true },
      }),
    );
  }

  async markExpired(subscriptionId: string) {
    const updated = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.EXPIRED },
    });
    await this.prisma.subscriptionEvent.create({
      data: { subscriptionId, type: 'expired' },
    });
    return updated;
  }

  async touchReminder(subscriptionId: string) {
    return this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { lastRemindedAt: new Date() },
    });
  }

  effectiveEnd(subscription: Subscription): Date {
    return subscription.status === SubscriptionStatus.TRIALING
      ? subscription.trialEndsAt
      : (subscription.currentPeriodEnd ?? subscription.trialEndsAt);
  }

  daysUntilEnd(subscription: Subscription, now: Date = new Date()): number {
    return Math.ceil((this.effectiveEnd(subscription).getTime() - now.getTime()) / 86_400_000);
  }
}
