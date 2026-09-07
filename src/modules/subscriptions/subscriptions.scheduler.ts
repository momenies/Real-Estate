import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscriptionStatus } from '@prisma/client';
import { SubscriptionsService } from './subscriptions.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { OWNER } from '../whatsapp/messages';

/** Days before expiry on which the owner is nudged - not every day. */
const REMINDER_DAYS = [14, 7, 3, 1];

/**
 * Watches every trial and paid period across the network.
 *
 * The three free months only convert if the owner is reminded before they
 * lapse, and reminded in the same WhatsApp thread they already use.
 */
@Injectable()
export class SubscriptionsScheduler {
  private readonly logger = new Logger(SubscriptionsScheduler.name);

  constructor(
    private readonly subscriptions: SubscriptionsService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsapp: WhatsappService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async run(): Promise<void> {
    try {
      await this.remindAndExpire();
    } catch (error) {
      this.logger.error(`Subscription sweep failed: ${(error as Error).message}`);
    }
  }

  private async remindAndExpire(): Promise<void> {
    const now = new Date();
    const expiring = await this.subscriptions.findExpiring(Math.max(...REMINDER_DAYS));

    for (const subscription of expiring) {
      const daysLeft = this.subscriptions.daysUntilEnd(subscription, now);

      if (daysLeft <= 0) {
        const access = await this.subscriptions.checkAccess(subscription.officeId, now);
        // A grace period is still access; only expire once it has run out too.
        if (!access.allowed && subscription.status !== SubscriptionStatus.EXPIRED) {
          await this.subscriptions.markExpired(subscription.id);
          await this.whatsapp
            .notifyOwner(subscription.officeId, OWNER.trialExpired(subscription.office.name))
            .catch(() => undefined);
          this.logger.log(`Subscription expired for office ${subscription.officeId}`);
        }
        continue;
      }

      if (!REMINDER_DAYS.includes(daysLeft)) continue;
      // One reminder per day at most, even if the sweep runs twice.
      if (
        subscription.lastRemindedAt &&
        now.getTime() - subscription.lastRemindedAt.getTime() < 20 * 3_600_000
      ) {
        continue;
      }

      await this.whatsapp
        .notifyOwner(subscription.officeId, OWNER.trialReminder(subscription.office.name, daysLeft))
        .catch(() => undefined);
      await this.subscriptions.touchReminder(subscription.id);
    }
  }
}
