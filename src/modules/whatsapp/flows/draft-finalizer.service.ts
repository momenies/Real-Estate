import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PropertyStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { TenantStore } from '../../../common/tenancy/tenant-context';
import { ConversationState } from '../conversation.service';
import { OwnerFlowService } from './owner-flow.service';

/** How long the owner must pause before the bot answers. */
const QUIET_SECONDS = 25;

/**
 * Waits for the owner to finish.
 *
 * An office owner sends a burst - eight photos, a video, then the price - and
 * replying to each one would be unbearable. This watches for a pause, then
 * responds exactly once: either asking for the single missing field, or showing
 * the summary to approve.
 */
@Injectable()
export class DraftFinalizerService {
  private readonly logger = new Logger(DraftFinalizerService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ownerFlow: OwnerFlowService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.finalizeIdleDrafts();
    } catch (error) {
      this.logger.error(`Draft finalizer failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async finalizeIdleDrafts(): Promise<void> {
    const cutoff = new Date(Date.now() - QUIET_SECONDS * 1000);

    const conversations = await TenantStore.runAsSuperAdmin(() =>
      this.prisma.conversation.findMany({
        where: {
          actor: 'OWNER',
          state: ConversationState.DRAFT_COLLECTING,
          draftPropertyId: { not: null },
          updatedAt: { lt: cutoff },
        },
        include: { office: { include: { settings: true } } },
        take: 25,
      }),
    );

    for (const conversation of conversations) {
      await TenantStore.runAsOffice(conversation.officeId, async () => {
        const draft = await this.prisma.tenant.property.findUnique({
          where: { id: conversation.draftPropertyId! },
        });
        if (!draft || draft.status !== PropertyStatus.DRAFT) {
          await this.prisma.tenant.conversation.update({
            where: { id: conversation.id },
            data: { state: ConversationState.IDLE, draftPropertyId: null },
          });
          return;
        }
        await this.ownerFlow.promptNextStep(conversation.office, conversation.waId, draft);
      });
    }
  }
}
