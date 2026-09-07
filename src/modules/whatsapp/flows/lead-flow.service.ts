import { Injectable } from '@nestjs/common';
import {
  DealType,
  Lead,
  LeadIntent,
  MediaType,
  Office,
  OfficeSettings,
  PropertyType,
} from '@prisma/client';
import { LeadsService } from '../../leads/leads.service';
import { PropertiesService } from '../../properties/properties.service';
import { AntiSpamService } from '../../broadcasts/anti-spam.service';
import { ConversationService, ConversationState } from '../conversation.service';
import { LEAD, TYPE_LABELS, propertyCard } from '../messages';
import { InboundMessage } from '../whatsapp.types';
import { WhatsappApiService } from '../whatsapp-api.service';
import { normalizeArabic } from '../../../common/utils/arabic.util';

export const LeadAction = {
  INTENT: 'lead:intent',
  TYPE: 'lead:type',
  BUDGET: 'lead:budget',
  DISTRICT_ANY: 'lead:district:any',
  MORE: 'lead:more',
} as const;

const BUDGET_BANDS: Array<{ id: string; title: string; min: number | null; max: number | null }> = [
  { id: 'lead:budget:0-500000', title: 'أقل من 500 ألف', min: null, max: 500_000 },
  { id: 'lead:budget:500000-1000000', title: '500 ألف - مليون', min: 500_000, max: 1_000_000 },
  { id: 'lead:budget:1000000-2000000', title: 'مليون - 2 مليون', min: 1_000_000, max: 2_000_000 },
  { id: 'lead:budget:2000000-0', title: 'أكثر من 2 مليون', min: 2_000_000, max: null },
  { id: 'lead:budget:0-0', title: 'غير محدد', min: null, max: null },
];

export interface LeadContext {
  office: Office & { settings: OfficeSettings | null };
  message: InboundMessage;
}

/**
 * Everything that happens when a customer messages the office number.
 *
 * The goal is that a customer who says nothing more than "السلام عليكم" still
 * ends up in the database as a qualified lead, classified by a few taps, with
 * the latest matching offers already in their hand.
 */
@Injectable()
export class LeadFlowService {
  constructor(
    private readonly leads: LeadsService,
    private readonly properties: PropertiesService,
    private readonly conversations: ConversationService,
    private readonly whatsapp: WhatsappApiService,
    private readonly antiSpam: AntiSpamService,
  ) {}

  async handle(context: LeadContext): Promise<void> {
    const { office, message } = context;
    const lead = await this.leads.getOrCreate(office.id, message.from, message.profileName);
    const conversation = await this.conversations.getOrCreate(office.id, message.from, 'LEAD');
    await this.conversations.attachLead(conversation.id, lead.id);
    await this.conversations.touchServiceWindow(conversation.id, message.timestamp);

    if (message.kind === 'text' && (await this.handleOptOut(context, lead, message.text ?? ''))) {
      return;
    }

    if (message.kind === 'button_reply' || message.kind === 'list_reply') {
      await this.handleAction(context, lead, message.replyId ?? '');
      return;
    }

    // A brand-new customer gets the qualification flow; a returning one is
    // answered as free text and their search recency refreshed.
    if (conversation.state === ConversationState.IDLE) {
      await this.askIntent(context, conversation.id);
      return;
    }

    if (message.kind === 'text') {
      await this.handleFreeText(context, lead, conversation.state, message.text ?? '');
    }
  }

  private async askIntent(context: LeadContext, conversationId: string): Promise<void> {
    await this.conversations.setState(conversationId, ConversationState.LEAD_ASK_INTENT);
    await this.whatsapp.sendButtons(
      context.office.whatsappPhoneNumberId ?? '',
      context.message.from,
      LEAD.greeting(context.office.name),
      [
        { id: `${LeadAction.INTENT}:BUY`, title: 'أبي أشتري' },
        { id: `${LeadAction.INTENT}:RENT`, title: 'أبي أستأجر' },
        { id: `${LeadAction.INTENT}:SELL`, title: 'أبي أبيع/أأجر' },
      ],
    );
  }

  private async handleAction(context: LeadContext, lead: Lead, actionId: string): Promise<void> {
    const conversation = await this.conversations.getOrCreate(
      context.office.id,
      context.message.from,
      'LEAD',
    );
    const phoneNumberId = context.office.whatsappPhoneNumberId ?? '';

    if (actionId.startsWith(`${LeadAction.INTENT}:`)) {
      const intent = actionId.split(':')[2] as LeadIntent;
      await this.leads.setIntent(lead.id, intent);

      if (intent === LeadIntent.SELL || intent === LeadIntent.LEASE_OUT) {
        // An owner-side enquiry is a lead for the office, not a search.
        await this.conversations.setState(conversation.id, ConversationState.LEAD_DONE);
        await this.whatsapp.sendText(
          phoneNumberId,
          context.message.from,
          'تمام ✅ سجّلنا طلبك، وبيتواصل معك المكتب لتقييم العقار وعرضه.',
        );
        return;
      }

      await this.conversations.setState(conversation.id, ConversationState.LEAD_ASK_TYPE);
      await this.whatsapp.sendList(
        phoneNumberId,
        context.message.from,
        LEAD.askPropertyType,
        'اختر النوع',
        (
          [
            PropertyType.APARTMENT,
            PropertyType.VILLA,
            PropertyType.LAND,
            PropertyType.BUILDING,
            PropertyType.SHOP,
            PropertyType.OFFICE,
          ] as PropertyType[]
        ).map((type) => ({ id: `${LeadAction.TYPE}:${type}`, title: TYPE_LABELS[type] })),
      );
      return;
    }

    if (actionId.startsWith(`${LeadAction.TYPE}:`)) {
      const type = actionId.split(':')[2] as PropertyType;
      const updated = await this.leads.addPropertyType(lead, type);
      await this.conversations.setState(conversation.id, ConversationState.LEAD_ASK_DISTRICT);
      await this.whatsapp.sendButtons(phoneNumberId, context.message.from, LEAD.askDistrict, [
        { id: LeadAction.DISTRICT_ANY, title: 'كل الأحياء' },
      ]);
      void updated;
      return;
    }

    if (actionId === LeadAction.DISTRICT_ANY) {
      await this.askBudget(context, conversation.id);
      return;
    }

    if (actionId.startsWith(`${LeadAction.BUDGET}:`)) {
      const band = BUDGET_BANDS.find((item) => item.id === actionId);
      await this.leads.setBudget(lead.id, band?.min ?? null, band?.max ?? null);
      await this.finishQualification(context, conversation.id);
      return;
    }

    if (actionId === LeadAction.MORE) {
      await this.sendMatches(context, lead, 5);
    }
  }

  private async askBudget(context: LeadContext, conversationId: string): Promise<void> {
    await this.conversations.setState(conversationId, ConversationState.LEAD_ASK_BUDGET);
    await this.whatsapp.sendList(
      context.office.whatsappPhoneNumberId ?? '',
      context.message.from,
      LEAD.askBudget,
      'اختر الميزانية',
      BUDGET_BANDS.map((band) => ({ id: band.id, title: band.title })),
    );
  }

  private async handleFreeText(
    context: LeadContext,
    lead: Lead,
    state: string,
    text: string,
  ): Promise<void> {
    const conversation = await this.conversations.getOrCreate(
      context.office.id,
      context.message.from,
      'LEAD',
    );

    if (state === ConversationState.LEAD_ASK_DISTRICT) {
      await this.leads.addDistrict(lead, normalizeArabic(text).replace(/^حي /, ''));
      await this.askBudget(context, conversation.id);
      return;
    }

    // Any later message means they are still looking - which is exactly what
    // "customers who searched this month" is measuring.
    await this.leads.recordSearch(lead.id);
    await this.sendMatches(context, lead, context.office.settings?.latestCount ?? 3);
  }

  private async finishQualification(context: LeadContext, conversationId: string): Promise<void> {
    await this.conversations.setState(conversationId, ConversationState.LEAD_DONE);
    await this.whatsapp.sendText(
      context.office.whatsappPhoneNumberId ?? '',
      context.message.from,
      LEAD.saved,
    );

    const lead = await this.leads.getOrCreate(context.office.id, context.message.from);
    if (context.office.settings?.autoSendLatestToNewLead !== false) {
      await this.sendMatches(context, lead, context.office.settings?.latestCount ?? 3);
    }
  }

  /**
   * "آخر الموجود" - sent automatically to a newly qualified customer.
   *
   * These go through the same deduplication ledger as a broadcast, so a
   * customer never receives an offer twice, whichever path sent it.
   */
  private async sendMatches(context: LeadContext, lead: Lead, take: number): Promise<void> {
    const phoneNumberId = context.office.whatsappPhoneNumberId ?? '';
    const dealType =
      lead.intent === LeadIntent.RENT
        ? DealType.RENT
        : lead.intent === LeadIntent.BUY
          ? DealType.SALE
          : null;

    const candidates = await this.properties.findMatchesForLead(
      context.office.id,
      {
        propertyTypes: lead.propertyTypes,
        districts: lead.districts,
        budgetMin: lead.budgetMin,
        budgetMax: lead.budgetMax,
        dealType,
      },
      take * 3,
    );

    const fresh: typeof candidates = [];
    for (const property of candidates) {
      const seen = await this.antiSpam.check({
        officeId: context.office.id,
        timezone: context.office.timezone,
        settings: {
          // The customer just asked, so the daily cap and cooldown do not
          // apply here - only deduplication and opt-out do.
          dailyCapPerLead: Number.MAX_SAFE_INTEGER,
          minHoursBetweenMessages: 0,
          quietHoursStart: 0,
          quietHoursEnd: 0,
        },
        lead,
        propertyId: property.id,
      });
      if (seen.allowed) fresh.push(property);
      if (fresh.length >= take) break;
    }

    if (fresh.length === 0) {
      await this.whatsapp.sendText(phoneNumberId, context.message.from, LEAD.noMatches);
      return;
    }

    await this.whatsapp.sendText(phoneNumberId, context.message.from, LEAD.latestIntro);

    for (const property of fresh) {
      const media = await this.properties.getMedia(property.id);
      const cover = media.find((item) => item.type === MediaType.IMAGE && item.url);
      const card = propertyCard({
        refCode: property.refCode,
        dealType: property.dealType,
        propertyType: property.propertyType,
        priceSar: property.priceSar,
        district: property.district,
        city: property.city,
        areaSqm: property.areaSqm,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        features: property.features,
        officeName: context.office.name,
        officePhone: context.office.whatsappDisplayNumber,
      });

      if (cover?.url) {
        await this.whatsapp.sendImage(phoneNumberId, context.message.from, cover.url, card);
      } else {
        await this.whatsapp.sendText(phoneNumberId, context.message.from, card);
      }

      if (property.latitude !== null && property.longitude !== null) {
        await this.whatsapp.sendLocation(
          phoneNumberId,
          context.message.from,
          property.latitude,
          property.longitude,
          property.district ?? undefined,
        );
      }

      await this.antiSpam.recordDelivery({
        officeId: context.office.id,
        timezone: context.office.timezone,
        leadId: lead.id,
        propertyId: property.id,
        channel: 'auto_latest',
      });
    }
  }

  private async handleOptOut(context: LeadContext, lead: Lead, text: string): Promise<boolean> {
    const normalized = normalizeArabic(text);
    if (/^(ايقاف|إيقاف|توقف|stop|الغاء الاشتراك)$/i.test(normalized)) {
      await this.leads.optOut(lead.id);
      await this.whatsapp.sendText(
        context.office.whatsappPhoneNumberId ?? '',
        context.message.from,
        LEAD.optedOut,
      );
      return true;
    }
    if (/^(اشتراك|تفعيل|start)$/i.test(normalized)) {
      await this.leads.optIn(lead.id);
      await this.whatsapp.sendText(
        context.office.whatsappPhoneNumberId ?? '',
        context.message.from,
        LEAD.optedIn,
      );
      return true;
    }
    return false;
  }
}
