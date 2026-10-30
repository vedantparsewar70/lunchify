import { db } from '../lib/firebase-admin';
import prisma from '../lib/prisma';
import { getTodayString, getOffsetDateString, APP_TIMEZONE } from '../lib/utils';
import { getMenuPublishStatus } from '../lib/menu-schedule';

async function debugMenu() {
  console.log('TIMEZONE:', APP_TIMEZONE);
  console.log('Today:', getTodayString(APP_TIMEZONE));
  console.log('Tomorrow:', getOffsetDateString(1, APP_TIMEZONE));

  console.log('\n--- Checking Firestore "menus" for 2026-10-10 ---');
  const snap = await db.collection('menus').where('date', '==', '2026-10-10').get();
  console.log('Firestore menus count for 2026-10-10:', snap.size);
  snap.docs.forEach(d => {
    const data = d.data();
    console.log(d.id, 'mealId:', data.mealId, 'isActive:', data.isActive, 'date:', data.date);
  });

  console.log('\n--- Checking prisma.menu.findMany for 2026-10-10 ---');
  const prismaMenus = await prisma.menu.findMany({
    where: { date: '2026-10-10' }
  });
  console.log('Prisma menus count:', prismaMenus.length);
  prismaMenus.forEach(m => console.log(m.id, 'mealId:', m.mealId, 'isActive:', m.isActive));

  console.log('\n--- Checking menu_publishes for 2026-10-10 ---');
  const pub = await getMenuPublishStatus('2026-10-10');
  console.log('Publish status for 2026-10-10:', pub);

  console.log('\n--- All Meals ---');
  const meals = await prisma.meal.findMany();
  meals.forEach(m => console.log(m.id, m.name));
}

debugMenu()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
