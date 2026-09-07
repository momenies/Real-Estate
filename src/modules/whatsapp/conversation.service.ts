import { Injectable } from '@nestjs/common';
import { Conversation, ConversationActor } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export const ConversationState = {
  IDLE: 'IDLE',
  // owner
  DRAFT_COLLECTING: 'DRAFT_COLLECTING',
  DRAFT_ASK_PRICE: 'DRAFT_ASK_PRICE',
  DRAFT_ASK_DISTRICT: 'DRAFT_ASK_DISTRICT',
  DRAFT_ASK_DEAL_TYPE: 'DRAFT_ASK_DEAL_TYPE',
  DRAFT_ASK_PROPERTY_TYPE: 'DRAFT_ASK_PROPERTY_TYPE',
  DRAFT_CONFIRM: 'DRAFT_CONFIRM',
  DRAFT_EDITING: 'DRAFT_EDITING',
  // lead
  LEAD_ASK_INTENT: 'LEAD_ASK_INTENT',
  LEAD_ASK_TYPE: 'LEAD_ASK_TYPE',
  LEAD_ASK_DISTRICT: 'LEAD_ASK_DISTRICT',
  LEAD_ASK_BUDGET: 'LEAD_ASK_BUDGET',
  LEAD_DONE: 'LEAD_DONE',
} as const;

export type ConversationStateValue = (typeof ConversationState)[keyof typeof ConversationState];

/** Meta only allows free-form replies within 24h of the customer's last message. */
const SERVICE_WINDOW_HOURS = 24;

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(
    officeId: string,
    waId: string,
    actor: ConversationActor,
  ): Promise<Conversation> {
    const existing = await this.prisma.tenant.conversation.findUnique({
      where: { officeId_waId: { officeId, waId } },
    });
    if (existing) return existing;
    return this.prisma.tenant.conversation.create({
      data: { officeId, waId, actor, state: ConversationState.IDLE },
    });
  }

  async setState(
    conversationId: string,
    state: ConversationStateValue,
    context?: Record<string, unknown>,
  ): Promise<Conversation> {
    return this.prisma.tenant.conversation.update({
      where: { id: conversationId },
      data: { state, ...(context ? { context: context as object } : {}) },
    });
  }

  async patchContext(
    conversation: Conversation,
    patch: Record<string, unknown>,
  ): Promise<Conversation> {
    const current = (conversation.context ?? {}) as Record<string, unknown>;
    return this.prisma.tenant.conversation.update({
      where: { id: conversation.id },
      data: { context: { ...current, ...patch } },
    });
  }

  async attachDraft(conversationId: string, draftPropertyId: string | null) {
    return this.prisma.tenant.conversation.update({
      where: { id: conversationId },
      data: { draftPropertyId },
    });
  }

  async attachLead(conversationId: string, leadId: string) {
    return this.prisma.tenant.conversation.update({
      where: { id: conversationId },
      data: { leadId },
    });
  }

  /** Re-opens the 24h window; called on every inbound customer message. */
  async touchServiceWindow(conversationId: string, at: Date = new Date()) {
    const expiresAt = new Date(at.getTime() + SERVICE_WINDOW_HOURS * 3_600_000);
    return this.prisma.tenant.conversation.update({
      where: { id: conversationId },
      data: { serviceWindowExpiresAt: expiresAt },
    });
  }

  static isWithinServiceWindow(
    conversation: Pick<Conversation, 'serviceWindowExpiresAt'>,
    now: Date = new Date(),
  ): boolean {
    return !!conversation.serviceWindowExpiresAt && conversation.serviceWindowExpiresAt > now;
  }

  context(conversation: Conversation): Record<string, unknown> {
    return (conversation.context ?? {}) as Record<string, unknown>;
  }
}
