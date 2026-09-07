import { PrismaClient, SkipReason } from '@prisma/client';
import { AntiSpamService } from './anti-spam.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantStore } from '../../common/tenancy/tenant-context';

const hasDatabase = !!process.env.DATABASE_URL;
const describeWithDb = hasDatabase ? describe : describe.skip;

const OFFICE = '55555555-5555-5555-5555-555555555555';
const TIMEZONE = 'Asia/Riyadh';

const SETTINGS = {
  dailyCapPerLead: 1,
  minHoursBetweenMessages: 20,
  // Quiet hours disabled for most cases so the rule under test is the only one firing.
  quietHoursStart: 0,
  quietHoursEnd: 0,
};

describeWithDb('AntiSpamService - protecting the customer and the number', () => {
  const base = new PrismaClient();
  let prisma: PrismaService;
  let service: AntiSpamService;
  let propertyId: string;
  let leadId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    service = new AntiSpamService(prisma);
    await base.office.deleteMany({ where: { id: OFFICE } });
    await base.office.create({
      data: { id: OFFICE, name: 'anti-spam-office', slug: 'anti-spam-office', timezone: TIMEZONE },
    });
    const property = await base.property.create({
      data: { officeId: OFFICE, refCode: 'AS-1', status: 'PUBLISHED' },
    });
    propertyId = property.id;
  });

  beforeEach(async () => {
    await base.propertyDelivery.deleteMany({ where: { officeId: OFFICE } });
    await base.leadDailyQuota.deleteMany({ where: { officeId: OFFICE } });
    await base.lead.deleteMany({ where: { officeId: OFFICE } });
    const lead = await base.lead.create({ data: { officeId: OFFICE, waId: '966500000100' } });
    leadId = lead.id;
  });

  afterAll(async () => {
    await base.office.deleteMany({ where: { id: OFFICE } });
    await base.$disconnect();
    await prisma.$disconnect();
  });

  const check = (overrides: Partial<Parameters<AntiSpamService['check']>[0]> = {}) =>
    TenantStore.runAsOffice(OFFICE, async () => {
      const lead = await base.lead.findUniqueOrThrow({ where: { id: leadId } });
      return service.check({
        officeId: OFFICE,
        timezone: TIMEZONE,
        settings: SETTINGS,
        lead,
        propertyId,
        ...overrides,
      });
    });

  it('allows a first send to a fresh customer', async () => {
    await expect(check()).resolves.toEqual({ allowed: true });
  });

  it('never sends the same property to the same customer twice', async () => {
    await TenantStore.runAsOffice(OFFICE, () =>
      service.recordDelivery({ officeId: OFFICE, timezone: TIMEZONE, leadId, propertyId }),
    );
    await expect(check()).resolves.toEqual({
      allowed: false,
      reason: SkipReason.ALREADY_RECEIVED_PROPERTY,
    });
  });

  it('stops a second advert to the same customer on the same day', async () => {
    await TenantStore.runAsOffice(OFFICE, () =>
      service.recordDelivery({ officeId: OFFICE, timezone: TIMEZONE, leadId, propertyId }),
    );
    // A different property, so deduplication is not what blocks it.
    const other = await base.property.create({
      data: { officeId: OFFICE, refCode: `AS-${Date.now()}`, status: 'PUBLISHED' },
    });
    await expect(check({ propertyId: other.id })).resolves.toEqual({
      allowed: false,
      reason: SkipReason.DAILY_CAP_REACHED,
    });
  });

  it('respects the cooldown between messages once the daily cap is raised', async () => {
    await base.lead.update({
      where: { id: leadId },
      data: { lastBroadcastAt: new Date(Date.now() - 2 * 3_600_000) },
    });
    await expect(
      check({ settings: { ...SETTINGS, dailyCapPerLead: 5 } }),
    ).resolves.toEqual({ allowed: false, reason: SkipReason.COOLDOWN_ACTIVE });
  });

  it('honours opt-out above every other rule', async () => {
    await base.lead.update({ where: { id: leadId }, data: { optedOut: true } });
    await expect(check()).resolves.toEqual({ allowed: false, reason: SkipReason.OPTED_OUT });
  });

  it('defers sending during quiet hours', async () => {
    const nowHour = new Date().getUTCHours();
    await expect(
      check({ settings: { ...SETTINGS, quietHoursStart: 0, quietHoursEnd: 24 } }),
    ).resolves.toEqual({ allowed: false, reason: SkipReason.QUIET_HOURS });
    expect(nowHour).toBeGreaterThanOrEqual(0);
  });

  it('writes the dedup record and the daily counter together', async () => {
    await TenantStore.runAsOffice(OFFICE, () =>
      service.recordDelivery({ officeId: OFFICE, timezone: TIMEZONE, leadId, propertyId }),
    );
    const deliveries = await base.propertyDelivery.count({ where: { leadId, propertyId } });
    const quota = await base.leadDailyQuota.findFirst({ where: { leadId } });
    const lead = await base.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(deliveries).toBe(1);
    expect(quota?.sentCount).toBe(1);
    expect(lead.lastBroadcastAt).not.toBeNull();
  });
});

describeWithDb('AntiSpamService - rule precedence', () => {
  const base = new PrismaClient();
  let prisma: PrismaService;
  let service: AntiSpamService;
  const OFFICE_P = '66666666-6666-6666-6666-666666666666';

  beforeAll(async () => {
    prisma = new PrismaService();
    service = new AntiSpamService(prisma);
    await base.office.deleteMany({ where: { id: OFFICE_P } });
    await base.office.create({
      data: { id: OFFICE_P, name: 'precedence', slug: 'precedence', timezone: 'Asia/Riyadh' },
    });
  });

  afterAll(async () => {
    await base.office.deleteMany({ where: { id: OFFICE_P } });
    await base.$disconnect();
    await prisma.$disconnect();
  });

  /**
   * Regression: quiet hours used to be checked first, which reported an
   * already-delivered property as merely "deferred". The caller then queued a
   * duplicate instead of dropping it.
   */
  it('reports a duplicate as a duplicate even during quiet hours', async () => {
    const lead = await base.lead.create({ data: { officeId: OFFICE_P, waId: '966500000300' } });
    const property = await base.property.create({
      data: { officeId: OFFICE_P, refCode: 'PR-1', status: 'PUBLISHED' },
    });
    await TenantStore.runAsOffice(OFFICE_P, () =>
      service.recordDelivery({
        officeId: OFFICE_P,
        timezone: 'Asia/Riyadh',
        leadId: lead.id,
        propertyId: property.id,
      }),
    );

    const decision = await TenantStore.runAsOffice(OFFICE_P, async () =>
      service.check({
        officeId: OFFICE_P,
        timezone: 'Asia/Riyadh',
        // Quiet hours covering the entire day.
        settings: { ...SETTINGS, quietHoursStart: 0, quietHoursEnd: 24 },
        lead: await base.lead.findUniqueOrThrow({ where: { id: lead.id } }),
        propertyId: property.id,
      }),
    );

    expect(decision).toEqual({
      allowed: false,
      reason: SkipReason.ALREADY_RECEIVED_PROPERTY,
    });
  });
});
