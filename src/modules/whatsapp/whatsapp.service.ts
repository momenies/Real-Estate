import { Injectable, Logger } from '@nestjs/common';
import { MessageDirection, MessageStatus, OfficeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantStore } from '../../common/tenancy/tenant-context';
import { OfficesService } from '../offices/offices.service';
import { OwnerFlowService } from './flows/owner-flow.service';
import { LeadFlowService } from './flows/lead-flow.service';
import { InboundMessage, InboundStatus, parseWebhook } from './whatsapp.types';
import { OWNER } from './messages';
import { WhatsappApiService } from './whatsapp-api.service';

const STATUS_MAP: Record<InboundStatus['status'], MessageStatus> = {
  sent: MessageStatus.SENT,
  delivered: MessageStatus.DELIVERED,
  read: MessageStatus.READ,
  failed: MessageStatus.FAILED,
};

/**
 * The front door for every inbound WhatsApp event.
 *
 * Its three jobs, in order: process each event exactly once, work out which
 * office the message belongs to, and decide whether the sender is that office's
 * owner or one of their customers - two completely different conversations on
 * the same number.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly offices: OfficesService,
    private readonly ownerFlow: OwnerFlowService,
    private readonly leadFlow: LeadFlowService,
    private readonly whatsapp: WhatsappApiService,
  ) {}

  async processWebhook(body: unknown): Promise<void> {
    const { messages, statuses } = parseWebhook(body);

    for (const message of messages) {
      try {
        await this.processMessage(message);
      } catch (error) {
        this.logger.error(
          `Failed to process message ${message.waMessageId}: ${(error as Error).message}`,
          (error as Error).stack,
        );
      }
    }

    for (const status of statuses) {
      await this.recordStatus(status).catch((error) =>
        this.logger.warn(`Status update ignored: ${(error as Error).message}`),
      );
    }
  }

  private async processMessage(message: InboundMessage): Promise<void> {
    // Meta retries webhooks; the unique constraint makes replay a no-op.
    const claimed = await this.claimEvent(message.waMessageId, message);
    if (!claimed) {
      this.logger.debug(`Duplicate webhook ignored: ${message.waMessageId}`);
      return;
    }

    const office = await this.offices.findByWhatsappPhoneNumberId(message.phoneNumberId);
    if (!office) {
      this.logger.warn(`No office is registered for phone_number_id ${message.phoneNumberId}`);
      return;
    }
    if (office.status === OfficeStatus.SUSPENDED) {
      this.logger.warn(`Office ${office.id} is suspended; message dropped`);
      return;
    }

    await TenantStore.runAsOffice(office.id, async () => {
      await this.logInbound(office.id, message);

      const member = await this.prisma.tenant.user.findFirst({
        where: { officeId: office.id, waId: message.from, isActive: true },
      });

      if (member) {
        await this.ownerFlow.handle({ office, user: member, message });
      } else {
        await this.leadFlow.handle({ office, message });
      }
    });

    await this.markProcessed(message.waMessageId);
  }

  /**
   * Inserts the idempotency row. A duplicate insert means another delivery of
   * the same event is already being handled, so this one stops here.
   *
   * Only the unique-constraint violation counts as "already claimed". Anything
   * else - a dropped connection, a full disk - must surface: swallowing it
   * would silently discard a customer's message and look identical to a
   * routine Meta retry.
   */
  private async claimEvent(externalId: string, payload: unknown): Promise<boolean> {
    // Meta redelivers constantly, so the common retry is settled with a cheap
    // indexed lookup. Letting every one of them fail the unique constraint
    // instead would print a Prisma error on a completely normal path, and
    // teach whoever reads the logs to ignore real ones.
    const seen = await this.prisma.webhookEvent.findUnique({
      where: { provider_externalId: { provider: 'whatsapp', externalId } },
      select: { id: true },
    });
    if (seen) return false;

    try {
      await this.prisma.webhookEvent.create({
        data: { provider: 'whatsapp', externalId, payload: payload as object },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Two deliveries raced; the other one won and is handling it.
        return false;
      }
      this.logger.error(
        `Could not claim webhook event ${externalId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  private async markProcessed(externalId: string): Promise<void> {
    await this.prisma.webhookEvent
      .updateMany({
        where: { provider: 'whatsapp', externalId },
        data: { processedAt: new Date() },
      })
      .catch(() => undefined);
  }

  private async logInbound(officeId: string, message: InboundMessage): Promise<void> {
    await this.prisma.tenant.message.create({
      data: {
        officeId,
        waId: message.from,
        direction: MessageDirection.INBOUND,
        waMessageId: message.waMessageId,
        type: message.kind,
        body: message.text ?? message.caption,
        payload: message.raw as object,
        status: MessageStatus.DELIVERED,
      },
    });
  }

  private async recordStatus(status: InboundStatus): Promise<void> {
    const office = await this.offices.findByWhatsappPhoneNumberId(status.phoneNumberId);
    if (!office) return;

    await TenantStore.runAsOffice(office.id, async () => {
      await this.prisma.tenant.message.updateMany({
        where: { officeId: office.id, waMessageId: status.waMessageId },
        data: { status: STATUS_MAP[status.status], error: status.errorTitle },
      });

      // Mirror onto the broadcast ledger so the owner's report stays truthful.
      await this.prisma.tenant.broadcastRecipient.updateMany({
        where: { officeId: office.id, waMessageId: status.waMessageId },
        data: {
          status:
            status.status === 'failed'
              ? 'FAILED'
              : status.status === 'read'
                ? 'READ'
                : status.status === 'delivered'
                  ? 'DELIVERED'
                  : 'SENT',
          error: status.errorTitle,
        },
      });
    });
  }

  /** Used by the subscription cron to reach an office owner directly. */
  async notifyOwner(officeId: string, body: string): Promise<void> {
    const office = await this.offices.getOrThrow(officeId);
    const owner = await this.offices.findOwner(officeId);
    if (!owner?.waId || !office.whatsappPhoneNumberId) return;
    await this.whatsapp.sendText(office.whatsappPhoneNumberId, owner.waId, body);
  }

  async sendWelcome(officeId: string): Promise<void> {
    const office = await this.offices.getOrThrow(officeId);
    await this.notifyOwner(officeId, OWNER.welcome(office.name));
  }
}
