import { ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantExtension } from './tenant.extension';
import { TenantStore } from '../tenancy/tenant-context';

/**
 * Runs against a real PostgreSQL instance - the whole point is to prove Prisma
 * accepts the rewritten queries, which a mock could never show.
 */
const hasDatabase = !!process.env.DATABASE_URL;
const describeWithDb = hasDatabase ? describe : describe.skip;

const base = new PrismaClient();
const prisma = base.$extends(tenantExtension);

const OFFICE_A = '33333333-3333-3333-3333-333333333333';
const OFFICE_B = '44444444-4444-4444-4444-444444444444';

describeWithDb('tenant isolation extension', () => {
  beforeAll(async () => {
    await base.office.deleteMany({ where: { id: { in: [OFFICE_A, OFFICE_B] } } });
    for (const [id, slug] of [
      [OFFICE_A, 'ext-office-a'],
      [OFFICE_B, 'ext-office-b'],
    ]) {
      await base.office.create({ data: { id, name: slug, slug } });
      await base.property.create({
        data: {
          officeId: id,
          refCode: `${slug}-1`,
          status: 'PUBLISHED',
          district: slug === 'ext-office-a' ? 'النرجس' : 'الملقا',
        },
      });
    }
  });

  afterAll(async () => {
    await base.office.deleteMany({ where: { id: { in: [OFFICE_A, OFFICE_B] } } });
    await base.$disconnect();
  });

  it('narrows findMany to the office in scope', async () => {
    const rows = await TenantStore.runAsOffice(OFFICE_A, () => prisma.property.findMany());
    expect(rows).toHaveLength(1);
    expect(rows[0].district).toBe('النرجس');
  });

  it('hides another office even when its id is asked for explicitly', async () => {
    const rows = await TenantStore.runAsOffice(OFFICE_A, () =>
      prisma.property.findMany({ where: { officeId: OFFICE_B } }),
    );
    expect(rows).toHaveLength(0);
  });

  it('stamps writes with the office in scope, ignoring a forged officeId', async () => {
    const created = await TenantStore.runAsOffice(OFFICE_A, () =>
      prisma.lead.create({ data: { officeId: OFFICE_B, waId: '966500000001' } }),
    );
    expect(created.officeId).toBe(OFFICE_A);
    await base.lead.delete({ where: { id: created.id } });
  });

  it('keeps compound unique lookups valid after rewriting', async () => {
    // Regression: AND-wrapping this where would make Prisma reject the query.
    const lead = await base.lead.create({ data: { officeId: OFFICE_A, waId: '966500000002' } });
    const found = await TenantStore.runAsOffice(OFFICE_A, () =>
      prisma.lead.findUnique({ where: { officeId_waId: { officeId: OFFICE_A, waId: '966500000002' } } }),
    );
    expect(found?.id).toBe(lead.id);
    await base.lead.delete({ where: { id: lead.id } });
  });

  it('refuses a unique lookup pinned to another office', async () => {
    await expect(
      TenantStore.runAsOffice(OFFICE_A, () =>
        prisma.lead.findUnique({
          where: { officeId_waId: { officeId: OFFICE_A, waId: 'x' }, officeId: OFFICE_B },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses any tenant query with no office in scope', async () => {
    await expect(prisma.property.findMany()).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the super admin read the whole network', async () => {
    const rows = await TenantStore.runAsSuperAdmin(() =>
      prisma.property.findMany({ where: { officeId: { in: [OFFICE_A, OFFICE_B] } } }),
    );
    expect(rows).toHaveLength(2);
  });
});
