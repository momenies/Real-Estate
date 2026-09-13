import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';

const hasDatabase = !!process.env.DATABASE_URL;
const describeWithDb = hasDatabase ? describe : describe.skip;

const OFFICE = '77777777-7777-7777-7777-777777777777';

/**
 * The control surface: the levers the platform owner pulls, and the guarantee
 * that nobody else can pull them.
 */
describeWithDb('super admin control surface', () => {
  const base = new PrismaClient();
  let app: INestApplication;
  let origin: string;
  let adminToken: string;
  let officeToken: string;

  const call = (path: string, token: string, init: RequestInit = {}) =>
    fetch(`${origin}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });

  beforeAll(async () => {
    // No live cron jobs mutating the database underneath the assertions.
    process.env.WORKERS_ENABLED = 'false';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    await app.listen(0);
    origin = await app.getUrl();

    await base.office.deleteMany({ where: { id: OFFICE } });
    await base.office.create({
      data: {
        id: OFFICE,
        name: 'control-office',
        slug: `control-office-${Date.now()}`,
        status: 'ACTIVE',
        settings: { create: {} },
      },
    });

    const jwt = app.get(JwtService);
    adminToken = await jwt.signAsync({
      sub: '00000000-0000-0000-0000-0000000000a1',
      role: 'SUPER_ADMIN',
      officeId: null,
      name: 'owner',
    });
    officeToken = await jwt.signAsync({
      sub: '00000000-0000-0000-0000-0000000000b1',
      role: 'OFFICE_OWNER',
      officeId: OFFICE,
      name: 'office owner',
    });
  }, 60_000);

  afterAll(async () => {
    await base.auditLog.deleteMany({ where: { officeId: OFFICE } });
    await base.office.deleteMany({ where: { id: OFFICE } });
    await base.$disconnect();
    await app?.close();
  });

  it('suspends and reactivates an office', async () => {
    const suspend = await call(`/api/admin/offices/${OFFICE}/status`, adminToken, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'SUSPENDED' }),
    });
    expect(suspend.status).toBe(200);
    expect((await base.office.findUniqueOrThrow({ where: { id: OFFICE } })).status).toBe(
      'SUSPENDED',
    );

    const reactivate = await call(`/api/admin/offices/${OFFICE}/status`, adminToken, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    expect(reactivate.status).toBe(200);
    expect((await base.office.findUniqueOrThrow({ where: { id: OFFICE } })).status).toBe('ACTIVE');
  });

  it("tunes an office's guardrails, which its own endpoint cannot do for it", async () => {
    const response = await call(`/api/admin/offices/${OFFICE}/settings`, adminToken, {
      method: 'PATCH',
      body: JSON.stringify({ dailyCapPerLead: 3, quietHoursStart: 21 }),
    });
    expect(response.status).toBe(200);

    const settings = await base.officeSettings.findUniqueOrThrow({ where: { officeId: OFFICE } });
    expect(settings.dailyCapPerLead).toBe(3);
    expect(settings.quietHoursStart).toBe(21);
  });

  it('refuses a guardrail that would put the office number at risk', async () => {
    const response = await call(`/api/admin/offices/${OFFICE}/settings`, adminToken, {
      method: 'PATCH',
      body: JSON.stringify({ dailyCapPerLead: 500, broadcastRatePerMinute: 5000 }),
    });
    expect(response.status).toBe(400);

    const settings = await base.officeSettings.findUniqueOrThrow({ where: { officeId: OFFICE } });
    expect(settings.dailyCapPerLead).toBe(3);
  });

  it('records every control action in the trail', async () => {
    const response = await call('/api/admin/audit?take=50', adminToken);
    expect(response.status).toBe(200);
    const rows = (await response.json()) as Array<{
      action: string;
      officeId: string | null;
      meta: Record<string, unknown> | null;
    }>;

    const mine = rows.filter((row) => row.officeId === OFFICE);
    expect(mine.map((row) => row.action)).toEqual(
      expect.arrayContaining(['office_suspended', 'office_settings_updated']),
    );

    // The trail is a diff, not just "something changed".
    const settingsEntry = mine.find((row) => row.action === 'office_settings_updated');
    expect(settingsEntry?.meta).toMatchObject({
      changed: { dailyCapPerLead: { from: 1, to: 3 } },
    });
  });

  it.each([
    ['PATCH', `/api/admin/offices/${OFFICE}/status`, '{"status":"SUSPENDED"}'],
    ['PATCH', `/api/admin/offices/${OFFICE}/settings`, '{"dailyCapPerLead":9}'],
    ['GET', '/api/admin/audit', null],
    ['GET', `/api/admin/offices/${OFFICE}/settings`, null],
  ])('refuses %s %s to an office user', async (method, path, body) => {
    const response = await call(path, officeToken, {
      method,
      ...(body ? { body } : {}),
    });
    expect(response.status).toBe(403);
  });

  it('redirects the bare root to the dashboard', async () => {
    const response = await fetch(`${origin}/`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/dashboard/');
  });
});
