/**
 * Seeds one demo office with inventory and customers, so the flows can be
 * exercised without a live WhatsApp number.
 *
 * Safe to re-run: everything is keyed on a fixed demo slug.
 */
import {
  DealType,
  LeadIntent,
  LeadStatus,
  PrismaClient,
  PropertyStatus,
  PropertyType,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const DEMO_SLUG = 'demo-office';

const daysAgo = (days: number): Date => new Date(Date.now() - days * 86_400_000);

async function main(): Promise<void> {
  const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? 'admin@aqar.network').toLowerCase();
  await prisma.user.upsert({
    where: { email: superAdminEmail },
    update: {},
    create: {
      email: superAdminEmail,
      name: 'Platform Super Admin',
      role: UserRole.SUPER_ADMIN,
      passwordHash: await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD ?? 'change-me', 10),
    },
  });

  await prisma.office.deleteMany({ where: { slug: DEMO_SLUG } });

  const office = await prisma.office.create({
    data: {
      name: 'مكتب النموذج العقاري',
      slug: DEMO_SLUG,
      city: 'الرياض',
      ownerName: 'أبو محمد',
      status: 'ACTIVE',
      whatsappPhoneNumberId: 'DEMO_PHONE_NUMBER_ID',
      whatsappDisplayNumber: '+966500000000',
      settings: { create: { defaultCity: 'الرياض' } },
      subscription: {
        create: {
          trialStartsAt: new Date(),
          trialEndsAt: new Date(Date.now() + 90 * 86_400_000),
        },
      },
      users: {
        create: {
          name: 'أبو محمد',
          role: UserRole.OFFICE_OWNER,
          phone: '966500000001',
          waId: '966500000001',
        },
      },
    },
  });

  await prisma.property.createMany({
    data: [
      {
        officeId: office.id,
        refCode: 'FLB-001',
        status: PropertyStatus.PUBLISHED,
        dealType: DealType.SALE,
        propertyType: PropertyType.VILLA,
        district: 'النرجس',
        city: 'الرياض',
        priceSar: 1_850_000,
        areaSqm: 375,
        bedrooms: 6,
        features: ['مسبح', 'مصعد'],
        publishedAt: daysAgo(3),
      },
      {
        officeId: office.id,
        refCode: 'SHE-002',
        status: PropertyStatus.PUBLISHED,
        dealType: DealType.RENT,
        propertyType: PropertyType.APARTMENT,
        district: 'الملقا',
        city: 'الرياض',
        priceSar: 55_000,
        areaSqm: 140,
        bedrooms: 3,
        publishedAt: daysAgo(1),
      },
    ],
  });

  await prisma.lead.createMany({
    data: [
      {
        officeId: office.id,
        waId: '966555000111',
        phone: '966555000111',
        name: 'سعود',
        intent: LeadIntent.BUY,
        status: LeadStatus.ACTIVE,
        propertyTypes: [PropertyType.VILLA],
        districts: ['النرجس'],
        budgetMin: 1_000_000,
        budgetMax: 2_000_000,
        // Inside the "last week" window.
        lastSearchAt: daysAgo(2),
      },
      {
        officeId: office.id,
        waId: '966555000222',
        phone: '966555000222',
        name: 'فهد',
        intent: LeadIntent.RENT,
        status: LeadStatus.ACTIVE,
        propertyTypes: [PropertyType.APARTMENT],
        districts: ['الملقا'],
        budgetMax: 70_000,
        // Inside "last month" but outside "last week".
        lastSearchAt: daysAgo(20),
      },
      {
        officeId: office.id,
        waId: '966555000333',
        phone: '966555000333',
        name: 'ناصر',
        intent: LeadIntent.BUY,
        status: LeadStatus.LOST,
        // Too old for any window - proves the audience filter works.
        lastSearchAt: daysAgo(200),
      },
    ],
  });

  // eslint-disable-next-line no-console
  console.log(`Seeded demo office ${office.name} (${office.id})`);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
