import { Injectable } from '@nestjs/common';
import {
  DealType,
  MediaType,
  Office,
  OfficeSettings,
  Property,
  PropertyType,
  User,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MediaService } from '../../media/media.service';
import { PropertiesService } from '../../properties/properties.service';
import { LeadsService } from '../../leads/leads.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { BroadcastsService, WINDOW_LABELS } from '../../broadcasts/broadcasts.service';
import { ConversationService, ConversationState } from '../conversation.service';
import { OWNER, TYPE_LABELS, DEAL_LABELS, formatSar } from '../messages';
import { InboundMessage } from '../whatsapp.types';
import { WhatsappApiService } from '../whatsapp-api.service';

export const OwnerAction = {
  PUBLISH: 'own:publish',
  EDIT: 'own:edit',
  CANCEL: 'own:cancel',
  DEAL_SALE: 'own:deal:SALE',
  DEAL_RENT: 'own:deal:RENT',
  BROADCAST: 'own:bc',
  BROADCAST_SKIP: 'own:bcskip',
  TIKTOK: 'own:tiktok',
  HARAJ: 'own:haraj',
} as const;

export interface OwnerContext {
  office: Office & { settings: OfficeSettings | null };
  user: User;
  message: InboundMessage;
}

/**
 * The office owner's entire interface.
 *
 * There is no dashboard and no app: photos, a short video, a price, a district
 * and a dropped location pin arrive as ordinary WhatsApp messages, and this
 * service turns them into a published listing. Anything it can infer, it
 * infers - it only asks when the answer cannot be guessed.
 */
@Injectable()
export class OwnerFlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly properties: PropertiesService,
    private readonly media: MediaService,
    private readonly leads: LeadsService,
    private readonly conversations: ConversationService,
    private readonly whatsapp: WhatsappApiService,
    private readonly subscriptions: SubscriptionsService,
    private readonly broadcasts: BroadcastsService,
  ) {}

  async handle(context: OwnerContext): Promise<void> {
    const { office, message } = context;
    const conversation = await this.conversations.getOrCreate(office.id, message.from, 'OWNER');

    if (message.kind === 'button_reply' || message.kind === 'list_reply') {
      await this.handleAction(context, message.replyId ?? '');
      return;
    }

    if (message.kind === 'text' && (await this.handleCommand(context, message.text ?? ''))) {
      return;
    }

    // Adding inventory is what the subscription pays for; reading never stops.
    const access = await this.subscriptions.checkAccess(office.id);
    if (!access.allowed) {
      await this.reply(context, OWNER.subscriptionBlocked);
      return;
    }

    const draftWindow = office.settings?.draftWindowMinutes ?? 30;
    let draft = await this.properties.getOpenDraft(office.id, context.user.id);
    if (!draft) {
      draft = await this.properties.createDraft(office.id, context.user.id, draftWindow);
      await this.conversations.attachDraft(conversation.id, draft.id);
    } else {
      await this.properties.extendDraftWindow(draft.id, draftWindow);
    }

    switch (message.kind) {
      case 'image':
      case 'video':
      case 'document':
        await this.attachMedia(context, draft, message);
        break;
      case 'location':
        await this.properties.setLocation(
          draft.id,
          message.latitude!,
          message.longitude!,
          message.locationName,
        );
        break;
      case 'text':
        draft =
          conversation.state === ConversationState.DRAFT_EDITING
            ? await this.properties.applyEdit(draft, message.text ?? '')
            : await this.properties.mergeParsedText(draft, message.text ?? '');
        break;
      default:
        break;
    }

    // The summary is not sent here. A finalizer waits for the owner to stop
    // typing, so sending eight photos does not produce eight replies.
    await this.conversations.setState(conversation.id, ConversationState.DRAFT_COLLECTING);
    await this.conversations.attachDraft(conversation.id, draft.id);
  }

  private async attachMedia(
    context: OwnerContext,
    draft: Property,
    message: InboundMessage,
  ): Promise<void> {
    const stored = message.mediaId
      ? await this.media.mirrorWhatsappMedia(context.office.id, draft.id, message.mediaId)
      : null;

    await this.properties.addMedia(context.office.id, draft.id, {
      type: message.mediaType ?? MediaType.DOCUMENT,
      waMediaId: message.mediaId,
      storageKey: stored?.storageKey,
      url: stored?.url,
      mimeType: stored?.mimeType ?? message.mimeType,
      sizeBytes: stored?.sizeBytes,
      caption: message.caption,
    });

    // Owners routinely put the price in the photo caption.
    if (message.caption) {
      await this.properties.mergeParsedText(draft, message.caption);
    }
  }

  /**
   * Asks for the one field that matters most, or shows the final summary.
   * Called by the finalizer once the owner has paused, and after each answer.
   */
  async promptNextStep(
    office: Office & { settings: OfficeSettings | null },
    ownerWaId: string,
    draft: Property,
  ): Promise<void> {
    const conversation = await this.conversations.getOrCreate(office.id, ownerWaId, 'OWNER');
    const phoneNumberId = office.whatsappPhoneNumberId ?? '';
    const missing = this.properties.missingFields(draft);

    if (missing.includes('dealType')) {
      await this.conversations.setState(conversation.id, ConversationState.DRAFT_ASK_DEAL_TYPE);
      await this.whatsapp.sendButtons(phoneNumberId, ownerWaId, OWNER.askDealType, [
        { id: OwnerAction.DEAL_SALE, title: 'للبيع' },
        { id: OwnerAction.DEAL_RENT, title: 'للإيجار' },
      ]);
      return;
    }

    if (missing.includes('propertyType')) {
      await this.conversations.setState(conversation.id, ConversationState.DRAFT_ASK_PROPERTY_TYPE);
      await this.whatsapp.sendList(
        phoneNumberId,
        ownerWaId,
        OWNER.askPropertyType,
        'اختر النوع',
        (
          [
            PropertyType.APARTMENT,
            PropertyType.VILLA,
            PropertyType.LAND,
            PropertyType.BUILDING,
            PropertyType.SHOP,
            PropertyType.OFFICE,
            PropertyType.FARM,
            PropertyType.CHALET,
            PropertyType.REST_HOUSE,
          ] as PropertyType[]
        ).map((type) => ({ id: `own:type:${type}`, title: TYPE_LABELS[type] })),
      );
      return;
    }

    if (missing.includes('price')) {
      await this.conversations.setState(conversation.id, ConversationState.DRAFT_ASK_PRICE);
      await this.whatsapp.sendText(phoneNumberId, ownerWaId, OWNER.askPrice);
      return;
    }

    if (missing.includes('district')) {
      await this.conversations.setState(conversation.id, ConversationState.DRAFT_ASK_DISTRICT);
      await this.whatsapp.sendText(phoneNumberId, ownerWaId, OWNER.askDistrict);
      return;
    }

    await this.sendSummary(office, ownerWaId, draft, conversation.id);
  }

  private async sendSummary(
    office: Office & { settings: OfficeSettings | null },
    ownerWaId: string,
    draft: Property,
    conversationId: string,
  ): Promise<void> {
    const mediaCount = await this.properties.countMedia(draft.id);
    const body = OWNER.summary({
      refCode: draft.refCode,
      dealType: draft.dealType,
      propertyType: draft.propertyType,
      priceSar: draft.priceSar,
      district: draft.district,
      city: draft.city,
      areaSqm: draft.areaSqm,
      bedrooms: draft.bedrooms,
      mediaCount,
      hasLocation: draft.latitude !== null,
    });

    await this.conversations.setState(conversationId, ConversationState.DRAFT_CONFIRM);
    await this.whatsapp.sendButtons(
      office.whatsappPhoneNumberId ?? '',
      ownerWaId,
      body,
      [
        { id: `${OwnerAction.PUBLISH}:${draft.id}`, title: '✅ نشر' },
        { id: `${OwnerAction.EDIT}:${draft.id}`, title: '✏️ تعديل' },
        { id: `${OwnerAction.CANCEL}:${draft.id}`, title: '🗑 إلغاء' },
      ],
    );
  }

  private async handleAction(context: OwnerContext, actionId: string): Promise<void> {
    const { office } = context;
    const conversation = await this.conversations.getOrCreate(
      office.id,
      context.message.from,
      'OWNER',
    );

    if (actionId.startsWith(`${OwnerAction.PUBLISH}:`)) {
      const propertyId = actionId.split(':')[2];
      const published = await this.properties.publish(office.id, propertyId);
      await this.conversations.setState(conversation.id, ConversationState.IDLE);
      await this.conversations.attachDraft(conversation.id, null);
      await this.whatsapp.sendButtons(
        office.whatsappPhoneNumberId ?? '',
        context.message.from,
        OWNER.published(published.refCode),
        [
          { id: `${OwnerAction.BROADCAST}:${published.id}:30`, title: 'عملاء آخر شهر' },
          { id: `${OwnerAction.BROADCAST}:${published.id}:7`, title: 'عملاء آخر أسبوع' },
          { id: `${OwnerAction.BROADCAST_SKIP}:${published.id}`, title: 'لاحقاً' },
        ],
      );
      return;
    }

    if (actionId.startsWith(`${OwnerAction.EDIT}:`)) {
      await this.conversations.setState(conversation.id, ConversationState.DRAFT_EDITING);
      await this.reply(context, OWNER.editHint);
      return;
    }

    if (actionId.startsWith(`${OwnerAction.CANCEL}:`)) {
      const propertyId = actionId.split(':')[2];
      await this.properties.archive(propertyId);
      await this.conversations.setState(conversation.id, ConversationState.IDLE);
      await this.conversations.attachDraft(conversation.id, null);
      await this.reply(context, OWNER.canceled);
      return;
    }

    if (actionId.startsWith('own:deal:') || actionId.startsWith('own:type:')) {
      const draft = await this.properties.getOpenDraft(office.id, context.user.id);
      if (!draft) return;
      const value = actionId.split(':')[2];
      const updated = await this.prisma.tenant.property.update({
        where: { id: draft.id },
        data: actionId.startsWith('own:deal:')
          ? { dealType: value as DealType }
          : { propertyType: value as PropertyType },
      });
      await this.promptNextStep(office, context.message.from, updated);
      return;
    }

    if (actionId.startsWith(`${OwnerAction.BROADCAST}:`)) {
      const [, , propertyId, windowDays] = actionId.split(':');
      await this.startBroadcast(context, propertyId, Number.parseInt(windowDays, 10));
      return;
    }

    if (actionId.startsWith(`${OwnerAction.BROADCAST_SKIP}:`)) {
      await this.reply(context, 'تمام، العرض محفوظ ويمكنك إرساله للعملاء في أي وقت.');
      return;
    }
  }

  /** "أرسله لعملاء آخر شهر" - the owner's one-tap distribution. */
  private async startBroadcast(
    context: OwnerContext,
    propertyId: string,
    windowDays: number,
  ): Promise<void> {
    const access = await this.subscriptions.checkAccess(context.office.id);
    if (!access.allowed) {
      await this.reply(context, OWNER.subscriptionBlocked);
      return;
    }

    const plan = await this.broadcasts.plan({
      officeId: context.office.id,
      propertyId,
      createdById: context.user.id,
      audienceWindowDays: windowDays,
    });

    await this.reply(
      context,
      plan.targeted === 0
        ? OWNER.broadcastNoAudience
        : OWNER.broadcastQueued(plan.targeted, WINDOW_LABELS[windowDays] ?? `آخر ${windowDays} يوم`),
    );
  }

  /** Plain-text shortcuts, for owners who prefer typing over tapping. */
  private async handleCommand(context: OwnerContext, text: string): Promise<boolean> {
    const command = text.trim();

    if (/^(عروضي|العروض)$/.test(command)) {
      const properties = await this.properties.findPublished(context.office.id, 5);
      const body = properties.length
        ? properties
            .map(
              (property) =>
                `• ${property.refCode} - ${TYPE_LABELS[property.propertyType]} ` +
                `${DEAL_LABELS[property.dealType]} - ${property.district ?? ''} - ` +
                formatSar(property.priceSar),
            )
            .join('\n')
        : 'ما فيه عروض منشورة بعد.';
      await this.reply(context, body);
      return true;
    }

    if (/^(عملائي|العملاء)$/.test(command)) {
      const counts = await this.leads.countByOffice(context.office.id);
      await this.reply(
        context,
        `👥 العملاء: ${counts.total}\n` +
          `نشطون آخر ٣٠ يوم: ${counts.activeLast30Days}\n` +
          `موقوفون: ${counts.optedOut}`,
      );
      return true;
    }

    if (/^(اشتراكي|الاشتراك)$/.test(command)) {
      const access = await this.subscriptions.checkAccess(context.office.id);
      await this.reply(
        context,
        access.inTrial
          ? `فترتك المجانية سارية، وتبقى ${access.daysRemaining} يوم.`
          : access.allowed
            ? `اشتراكك فعّال، وتبقى ${access.daysRemaining} يوم.`
            : OWNER.subscriptionBlocked,
      );
      return true;
    }

    if (/^(مساعدة|المساعدة|help)$/i.test(command)) {
      await this.reply(context, OWNER.help);
      return true;
    }

    return false;
  }

  private async reply(context: OwnerContext, body: string): Promise<void> {
    await this.whatsapp.sendText(
      context.office.whatsappPhoneNumberId ?? '',
      context.message.from,
      body,
    );
  }
}
