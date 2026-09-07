import { Prisma, PrismaClient } from '@prisma/client';

const hasDatabase = !!process.env.DATABASE_URL;
const describeWithDb = hasDatabase ? describe : describe.skip;

/**
 * Meta retries webhooks aggressively, so the idempotency claim runs constantly.
 * It has to tell two failures apart: a duplicate delivery (skip quietly) and a
 * real database failure (surface it) - swallowing the second would silently
 * discard a customer's message.
 */
describeWithDb('webhook idempotency claim', () => {
  const prisma = new PrismaClient();
  const externalId = `spec.${Date.now()}`;

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({ where: { provider: 'whatsapp-spec' } });
    await prisma.$disconnect();
  });

  const claim = async (id: string): Promise<boolean> => {
    try {
      await prisma.webhookEvent.create({
        data: { provider: 'whatsapp-spec', externalId: id, payload: {} },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }
  };

  it('claims an event once and refuses every redelivery', async () => {
    await expect(claim(externalId)).resolves.toBe(true);
    await expect(claim(externalId)).resolves.toBe(false);
    await expect(claim(externalId)).resolves.toBe(false);

    const rows = await prisma.webhookEvent.count({
      where: { provider: 'whatsapp-spec', externalId },
    });
    expect(rows).toBe(1);
  });

  it('raises the unique-violation code the handler keys on', async () => {
    const duplicate = prisma.webhookEvent.create({
      data: { provider: 'whatsapp-spec', externalId, payload: {} },
    });
    await expect(duplicate).rejects.toMatchObject({ code: 'P2002' });
  });

  it('does not disguise a non-duplicate failure as a duplicate', async () => {
    // A payload the column cannot hold fails with a different code, and must
    // propagate rather than be read as "already claimed".
    const bad = prisma.webhookEvent.create({
      data: { provider: 'whatsapp-spec', externalId: 'x'.repeat(5), payload: {} },
      select: { nonExistentField: true } as never,
    });
    await expect(bad).rejects.not.toMatchObject({ code: 'P2002' });
  });
});
