import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Production safety guard: Never run destructive operations or overwrite production data
  if (process.env.NODE_ENV === 'production') {
    console.log('🛡️ prisma/seed.ts execution is disabled in production to protect live data.');
    return;
  }

  console.log('🌱 Ensuring core master reference data is initialized...');

  // 1. System Settings (Idempotent upsert - preserves existing value)
  await prisma.systemSetting.upsert({
    where: { key: 'ALLOW_ALLERGY_ORDERS' },
    update: {},
    create: {
      key: 'ALLOW_ALLERGY_ORDERS',
      value: 'true',
    },
  });
  console.log('⚙️ Verified system settings.');

  // 2. Master Allergies (Child Profile Choices - idempotent upsert)
  const masterAllergiesList = [
    'Milk',
    'Peanuts',
    'Egg',
    'Soy',
    'Wheat',
    'Tree Nuts',
    'Fish',
    'Shellfish',
    'Sesame',
  ];
  for (const name of masterAllergiesList) {
    await prisma.allergy.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // 3. Master Allergens (Meal Allergens - idempotent upsert)
  const masterAllergensList = [
    'Milk',
    'Peanuts',
    'Tree Nuts',
    'Wheat',
    'Egg',
    'Soy',
    'Cashew',
    'Gluten',
    'Mustard',
    'Sesame',
  ];
  for (const name of masterAllergensList) {
    await prisma.allergen.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log('🏷️ Verified master allergies & allergens.');

  console.log('🎉 Reference data initialization complete! No production or user records were altered.');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
