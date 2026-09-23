import { PrismaClient } from '@prisma/client';
import { AntiSpamService } from './anti-spam.service';
import { BroadcastDispatcherService } from './broadcast-dispatcher.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SendResult, WhatsappApiService } from '../whatsapp/whatsapp-api.service';

const hasDatabase = !!process.env.DATABASE_URL;
const describeWithDb = hasDatabase ? describe : describe.skip;

const OFFICE = '77777777-7777-7777-7777-777777777777';
const FRESH_LEAD = '966500007771'; // wrote an hour ago
const QUIET_LEAD = '966500007772'; // wrote three weeks ago

interface Sent {
  to: string;
  how: 'free' | 'template';
  template?: string;
  components?: unknown[];
}

/**
 * The headline feature is "أرسلها لعملاء آخر شهر". By construction most of that
 * audience last wrote days or weeks ago, which puts them outside Meta's
 * 24-hour window where a free-form send is rejected with error 131047.
 *
 * So the dispatcher has to choose the channel per recipient. This drives the
 * real dispatcher against a real database with two leads on opposite sides of
 * the window and asserts each one was reached the only way that works.
 */
describeWithDb('dispatcher picks the channel by service window', () => {
  const base = new PrismaClient();
  let prisma: PrismaService;
  let sent: Sent[];

  /**
   * `workersEnabled` has to answer truthfully or `tick()` returns before doing
   * anything - the getter treats any falsy value as "workers off".
   */
  const fakeConfig = (values: Record<string, unknown>) => ({
    get: (key: string) => (key === 'workersEnabled' ? true : values[key]),
  });

  const dispatcherWith = (config?: { get: (key: string) => unknown }) => {
    const whatsapp = {
      sendImage: async (_id: string, to: string): Promise<SendResult> => {
        sent.push({ to, how: 'free' });
        return { ok: true, waMessageId: `wamid.${sent.length}` };
      },
      sendText: async (_id: string, to: string): Promise<SendResult> => {
        sent.push({ to, how: 'free' });
        return { ok: true, waMessageId: `wamid.${sent.length}` };
      },
      sendTemplate: async (
        _id: string,
        to: string,
        template: string,
        _lang: string,
        components?: unknown[],
      ): Promise<SendResult> => {
        sent.push({ to, how: 'template', template, components });
        return { ok: true, waMessageId: `wamid.${sent.length}` };
      },
    } as unknown as WhatsappApiService;

    return new BroadcastDispatcherService(
      prisma,
      whatsapp,
      new AntiSpamService(prisma),
      config as never,
    );
  };

  const seed = async (templateName: string | null) => {
    sent = [];
    await base.office.deleteMany({ where: { id: OFFICE } });
    await base.office.create({
      data: {
        id: OFFICE,
        name: 'مكتب النافذة',
        slug: `window-${Date.now()}`,
        status: 'ACTIVE',
        whatsappPhoneNumberId: `PNID_WINDOW_${Date.now()}`,
        timezone: 'Asia/Riyadh',
        settings: {
          create: {
            quietHoursStart: 0,
            quietHoursEnd: 0,
            broadcastRatePerMinute: 60,
            // Both leads must be eligible, so the caps cannot be what skips one.
            dailyCapPerLead: 10,
            minHoursBetweenMessages: 0,
            broadcastTemplateName: templateName,
          },
        },
      },
    });

    const property = await base.property.create({
      data: {
        officeId: OFFICE,
        refCode: 'WIN-1',
        status: 'PUBLISHED',
        district: 'النرجس',
        propertyType: 'VILLA',
        dealType: 'SALE',
        priceSar: 1_800_000,
        areaSqm: 400,
      },
    });

    const now = Date.now();
    const fresh = await base.lead.create({
      data: {
        officeId: OFFICE,
        waId: FRESH_LEAD,
        lastSearchAt: new Date(now - 3_600_000),
        lastMessageAt: new Date(now - 3_600_000),
      },
    });
    const quiet = await base.lead.create({
      data: {
        officeId: OFFICE,
        waId: QUIET_LEAD,
        lastSearchAt: new Date(now - 21 * 86_400_000),
        lastMessageAt: new Date(now - 21 * 86_400_000),
      },
    });

    const broadcast = await base.broadcast.create({
      data: {
        officeId: OFFICE,
        propertyId: property.id,
        status: 'QUEUED',
        audienceWindowDays: 30,
        totalTargeted: 2,
      },
    });
    for (const lead of [fresh, quiet]) {
      await base.broadcastRecipient.create({
        data: { officeId: OFFICE, broadcastId: broadcast.id, leadId: lead.id, status: 'PENDING' },
      });
    }
  };

  beforeAll(() => {
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await base.office.deleteMany({ where: { id: OFFICE } });
    await base.$disconnect();
    await prisma.$disconnect();
  });

  it('sends free-form inside the window and a template outside it', async () => {
    await seed('aqar_new_offer');

    await dispatcherWith().tick();

    expect(sent.find((row) => row.to === FRESH_LEAD)?.how).toBe('free');

    const quiet = sent.find((row) => row.to === QUIET_LEAD);
    expect(quiet?.how).toBe('template');
    expect(quiet?.template).toBe('aqar_new_offer');

    const recipients = await base.broadcastRecipient.findMany({ where: { officeId: OFFICE } });
    expect(recipients.every((row) => row.status === 'SENT')).toBe(true);
  });

  it('carries the ref code on the quick-reply button so the tap returns the offer', async () => {
    await seed('aqar_new_offer');

    await dispatcherWith().tick();

    const quiet = sent.find((row) => row.to === QUIET_LEAD);
    const button = (quiet?.components as Array<Record<string, unknown>>).find(
      (part) => part.type === 'button',
    );
    expect(button).toMatchObject({ sub_type: 'quick_reply', index: '0' });
    expect((button?.parameters as Array<{ payload: string }>)[0].payload).toBe(
      'lead:property:WIN-1',
    );
  });

  it('passes single-line body parameters - Meta rejects a newline', async () => {
    await seed('aqar_new_offer');

    await dispatcherWith().tick();

    const quiet = sent.find((row) => row.to === QUIET_LEAD);
    const body = (quiet?.components as Array<Record<string, unknown>>).find(
      (part) => part.type === 'body',
    );
    const values = (body?.parameters as Array<{ text: string }>).map((param) => param.text);
    expect(values).toHaveLength(3);
    for (const value of values) {
      expect(value).not.toMatch(/[\n\t]/);
      expect(value.trim()).not.toBe('');
    }
  });

  /**
   * The honest outcome when no template exists: skip, and say why. Sending
   * anyway would burn attempts on a rejection the owner never sees, and leave
   * him believing the offer went out.
   */
  it('skips an out-of-window lead as OUTSIDE_24H_WINDOW when no template is configured', async () => {
    await seed(null);

    await dispatcherWith(fakeConfig({})).tick();

    expect(sent.map((row) => row.to)).toEqual([FRESH_LEAD]);

    const quiet = await base.broadcastRecipient.findFirstOrThrow({
      where: { officeId: OFFICE, lead: { waId: QUIET_LEAD } },
    });
    expect(quiet.status).toBe('SKIPPED');
    expect(quiet.skipReason).toBe('OUTSIDE_24H_WINDOW');
  });

  it('falls back to the platform template when the office has none', async () => {
    await seed(null);

    await dispatcherWith(fakeConfig({ 'whatsapp.broadcastTemplate': 'platform_offer' })).tick();

    expect(sent.find((row) => row.to === QUIET_LEAD)).toMatchObject({
      how: 'template',
      template: 'platform_offer',
    });
  });
});
