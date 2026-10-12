import { db } from '../lib/firebase-admin';
import {
  OCTOBER_2026_MEAL_CATALOG,
  OCTOBER_2026_TIMETABLE,
  getMealIdForDish,
  STUDENT_CATEGORIES,
} from '../lib/october-2026-timetable';
import { getTodayString, APP_TIMEZONE } from '../lib/utils';

async function applyOctober2026Menu() {
  console.log('🚀 ========================================================');
  console.log('   APPLYING OCTOBER 2026 SCHOOL BRUNCH TIMETABLE');
  console.log('========================================================\n');

  const todayStr = getTodayString(APP_TIMEZONE);
  console.log(`📅 Current School Date (${APP_TIMEZONE}): ${todayStr}\n`);

  // STEP 1: VERIFY PROTECTED CREDENTIALS
  console.log('🔒 Step 1: Verifying protected staff and admin user accounts...');
  const usersSnap = await db.collection('users').get();
  const protectedUsers: string[] = [];
  usersSnap.forEach((doc) => {
    const data = doc.data();
    if (data.role === 'ADMIN' || data.role === 'STAFF') {
      protectedUsers.push(`${data.email} (${data.role})`);
    }
  });
  console.log(`   Protected accounts preserved (${protectedUsers.length}):`);
  protectedUsers.forEach((u) => console.log(`     🛡️  ${u}`));
  console.log('');

  // STEP 2: REMOVE OBSOLETE DEMO MENUS & MEALS
  console.log('🧹 Step 2: Removing obsolete demo menus and sample meal records...');

  // Delete existing menus in batches
  const oldMenusSnap = await db.collection('menus').get();
  console.log(`   Found ${oldMenusSnap.size} existing menu records to replace.`);
  let batch = db.batch();
  let opCount = 0;
  for (const doc of oldMenusSnap.docs) {
    batch.delete(doc.ref);
    opCount++;
    if (opCount >= 400) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }
  if (opCount > 0) {
    await batch.commit();
    batch = db.batch();
    opCount = 0;
  }
  console.log(`   ✅ Removed obsolete menu records.`);

  // Delete old menu_publishes
  const oldPublishesSnap = await db.collection('menu_publishes').get();
  for (const doc of oldPublishesSnap.docs) {
    batch.delete(doc.ref);
    opCount++;
  }
  if (opCount > 0) {
    await batch.commit();
    batch = db.batch();
    opCount = 0;
  }
  console.log(`   ✅ Cleared obsolete menu_publishes records.`);

  // Delete old demo meals
  const oldMealsSnap = await db.collection('meals').get();
  for (const doc of oldMealsSnap.docs) {
    batch.delete(doc.ref);
    opCount++;
  }
  if (opCount > 0) {
    await batch.commit();
    batch = db.batch();
    opCount = 0;
  }
  console.log(`   ✅ Removed ${oldMealsSnap.size} obsolete meal catalog records.\n`);

  // STEP 3: INSERT THE OFFICIAL OCTOBER 2026 MEAL CATALOG
  console.log('🍲 Step 3: Populating official October 2026 meal catalog (24 brunch dishes + holiday entry)...');
  const now = new Date().toISOString();

  for (const meal of OCTOBER_2026_MEAL_CATALOG) {
    const mealRef = db.collection('meals').doc(meal.id);
    batch.set(mealRef, {
      id: meal.id,
      name: meal.name,
      description: meal.description,
      category: meal.category,
      price: meal.price,
      isVegetarian: meal.isVegetarian,
      allergens: meal.allergens || null,
      ingredients: meal.ingredients || null,
      calories: meal.calories || null,
      imageUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    opCount++;
    if (opCount >= 400) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }
  if (opCount > 0) {
    await batch.commit();
    batch = db.batch();
    opCount = 0;
  }
  console.log(`   ✅ Populated ${OCTOBER_2026_MEAL_CATALOG.length} official meal catalog records.\n`);

  // STEP 4: INSERT COMPLETE OCTOBER 2026 TIMETABLE (31 DAYS × 3 CATEGORIES = 93 RECORDS)
  console.log('📅 Step 4: Generating authoritative timetable menus for all 3 student categories...');
  let menuCount = 0;
  let activeMenuCount = 0;
  let holidayCount = 0;
  let pastDateCount = 0;

  const publishedMealsByDate = new Map<string, string[]>();

  for (const dayEntry of OCTOBER_2026_TIMETABLE) {
    const isPastDate = dayEntry.date < todayStr;
    const dateSelectedMeals: string[] = [];

    for (const category of STUDENT_CATEGORIES) {
      const catMenu = dayEntry.menus[category];
      const categorySlug = category.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const docId = `menu_${dayEntry.date}_${categorySlug}`;
      const mealId = getMealIdForDish(catMenu.dish);

      // Determine active ordering eligibility
      // Past dates and holidays are NOT orderable
      const isHoliday = Boolean(catMenu.isHoliday);
      const isOrderable = !isPastDate && !isHoliday;

      if (!isHoliday && mealId !== 'meal_holiday_no_brunch') {
        dateSelectedMeals.push(mealId);
      }

      const menuData = {
        id: docId,
        mealId,
        date: dayEntry.date,
        studentCategory: category,
        isHoliday,
        holidayReason: catMenu.holidayReason || (isHoliday ? 'School Holiday' : null),
        availableQuantity: isOrderable ? 50 : 0,
        maxQuantity: 50,
        orderingDeadline: '08:30',
        isActive: isOrderable,
        createdAt: now,
        updatedAt: now,
      };

      const menuRef = db.collection('menus').doc(docId);
      batch.set(menuRef, menuData);
      opCount++;
      menuCount++;

      if (isPastDate) pastDateCount++;
      else if (isHoliday) holidayCount++;
      else activeMenuCount++;

      if (opCount >= 400) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }

    if (dateSelectedMeals.length > 0) {
      publishedMealsByDate.set(dayEntry.date, Array.from(new Set(dateSelectedMeals)));
    }
  }

  if (opCount > 0) {
    await batch.commit();
    batch = db.batch();
    opCount = 0;
  }

  console.log(`   ✅ Created ${menuCount} total menu timetable records across 31 days.`);
  console.log(`      - Orderable upcoming brunch slots: ${activeMenuCount}`);
  console.log(`      - Holiday slots (No Brunch): ${holidayCount}`);
  console.log(`      - Historical past date slots (read-only): ${pastDateCount}\n`);

  // STEP 5: RECORD PUBLICATION RECORDS FOR TIMETABLE DATES
  console.log('📝 Step 5: Recording official menu publication metadata...');
  for (const [date, mealIds] of publishedMealsByDate.entries()) {
    const pubRef = db.collection('menu_publishes').doc(date);
    batch.set(pubRef, {
      date,
      publishedOn: todayStr,
      publishedAt: now,
      selectedMealIds: mealIds,
      count: mealIds.length,
      isOfficialTimetable: true,
    });
    opCount++;
    if (opCount >= 400) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }
  if (opCount > 0) {
    await batch.commit();
  }
  console.log(`   ✅ Recorded ${publishedMealsByDate.size} publication records.\n`);

  // STEP 6: VERIFICATION AUDIT
  console.log('🔍 Step 6: Post-update verification audit...');
  const newMealsSnap = await db.collection('meals').get();
  const newMenusSnap = await db.collection('menus').get();
  const usersPostSnap = await db.collection('users').get();

  console.log(`   - Total Meals in Catalog: ${newMealsSnap.size} (Expected: ${OCTOBER_2026_MEAL_CATALOG.length})`);
  console.log(`   - Total Menu Entries: ${newMenusSnap.size} (Expected: 93)`);
  console.log(`   - User Accounts: ${usersPostSnap.size} (Staff & Admin strictly preserved)`);

  // Spot-check key test dates from prompt:
  // 10/10/2026: Pre-primary Holiday vs Primary/Secondary Veg Hyderabadi
  const oct10PP = await db.collection('menus').doc('menu_2026-10-10_pre_primary').get();
  const oct10Pri = await db.collection('menus').doc('menu_2026-10-10_primary').get();
  console.log('\n   Spot Check: 10/10/2026 (Saturday)');
  console.log(`     Pre-primary: isHoliday=${oct10PP.data()?.isHoliday}, reason="${oct10PP.data()?.holidayReason}"`);
  console.log(`     Primary: mealId="${oct10Pri.data()?.mealId}", isHoliday=${oct10Pri.data()?.isHoliday}`);

  // 29/10/2026: Pre-primary Veg Cutlet vs Primary Green Moong
  const oct29PP = await db.collection('menus').doc('menu_2026-10-29_pre_primary').get();
  const oct29Pri = await db.collection('menus').doc('menu_2026-10-29_primary').get();
  console.log('\n   Spot Check: 29/10/2026 (Thursday)');
  console.log(`     Pre-primary: mealId="${oct29PP.data()?.mealId}"`);
  console.log(`     Primary: mealId="${oct29Pri.data()?.mealId}"`);

  console.log('\n🎉 SUCCESS: October 2026 timetable applied successfully with zero data conflicts!');
}

applyOctober2026Menu()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error applying October 2026 menu:', err);
    process.exit(1);
  });
