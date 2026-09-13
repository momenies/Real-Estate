import { PrismaClient } from '@prisma/client';
import { AntiSpamService } from './anti-spam.service';
import { BroadcastDispatcherService } from './broadcast-dispatcher.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SendResult, WhatsappApiService } from '../whatsapp/whatsapp-api.service';

const hasDatabase = !!process.env.DATABASE_URL;
const describeWithDb = hasDatabase ? describe : describe.skip;

const OFFICE = '88888888-8888-8888-8888-888888888888';
const LEAD_WA_ID = '966500008888';

/**
 * Regression: suspending an office used to silence its bot while its queued
 * broadcast kept reaching customers - the dispatcher never looked at office
 * status. This drives the real dispatcher against a real database and asserts
 * nothing leaves for a suspended office.
 */
describeWithDb('broadcast dispatcher respects suspension', () => {
  const base = new PrismaClient();
  let prisma: PrismaService;
  let dispatcher: BroadcastDispatcherService;
  let sentTo: string[];

  beforeAll(async () => {
    prisma = new PrismaService();

    // A stand-in for the Cloud API that records who would have been messaged.
    const whatsapp = {
      sendImage: async (_id: string, to: string): Promise<SendResult> => {
        sentTo.push(to);
        return { ok: true, waMessageId: `wamid.${sentTo.length}` };
      },
      sendText: async (_id: string, to: string): Promise<SendResult> => {
        sentTo.push(to);
        return { ok: true, waMessageId: `wamid.${sentTo.length}` };
      },
    } as unknown as WhatsappApiService;

    dispatcher = new BroadcastDispatcherService(prisma, whatsapp, new AntiSpamService(prisma));
  });

  beforeEach(async () => {
    sentTo = [];
    await base.office.deleteMany({ where: { id: OFFICE } });
    await base.office.create({
      data: {
        id: OFFICE,
        name: 'suspension-office',
        slug: `suspension-${Date.now()}`,
        status: 'SUSPENDED',
        whatsappPhoneNumberId: `PNID_SUSPEND_${Date.now()}`,
        timezone: 'Asia/Riyadh',
        // Quiet hours off, so status is the only thing that can hold the send.
        settings: {
          create: { quietHoursStart: 0, quietHoursEnd: 0, broadcastRatePerMinute: 60 },
        },
      },
    });

    const property = await base.property.create({
      data: { officeId: OFFICE, refCode: 'SUS-1', status: 'PUBLISHED', district: 'النرجس' },
    });
    const lead = await base.lead.create({
      data: { officeId: OFFICE, waId: LEAD_WA_ID, lastSearchAt: new Date() },
    });
    const broadcast = await base.broadcast.create({
      data: {
        officeId: OFFICE,
        propertyId: property.id,
        status: 'QUEUED',
        audienceWindowDays: 30,
        totalTargeted: 1,
      },
    });
    await base.broadcastRecipient.create({
      data: { officeId: OFFICE, broadcastId: broadcast.id, leadId: lead.id, status: 'PENDING' },
    });
  });

  afterAll(async () => {
    await base.office.deleteMany({ where: { id: OFFICE } });
    await base.$disconnect();
    await prisma.$disconnect();
  });

  it('sends nothing while the office is suspended', async () => {
    await dispatcher.tick();

    expect(sentTo).not.toContain(LEAD_WA_ID);
    const recipient = await base.broadcastRecipient.findFirstOrThrow({
      where: { officeId: OFFICE },
    });
    expect(recipient.status).toBe('PENDING'); // held, not skipped - it resumes on reactivation
  });

  it('delivers the held broadcast once the office is reactivated', async () => {
    await base.office.update({ where: { id: OFFICE }, data: { status: 'ACTIVE' } });

    await dispatcher.tick();

    expect(sentTo).toContain(LEAD_WA_ID);
    const recipient = await base.broadcastRecipient.findFirstOrThrow({
      where: { officeId: OFFICE },
    });
    expect(recipient.status).toBe('SENT');
  });
});
