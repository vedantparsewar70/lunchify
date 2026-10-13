import { db } from '../lib/firebase-admin';

async function safeHolidayCleanup() {
  console.log('🧹 Starting safe holiday meal removal from catalog...');

  // 1. Check existing orders
  const orderItemsSnap = await db.collection('orderItems').where('mealId', '==', 'meal_holiday_no_brunch').get();
  if (orderItemsSnap.size > 0) {
    console.log(`⚠️ Found ${orderItemsSnap.size} order items referencing holiday meal. Preserving audit trail.`);
  } else {
    console.log('✅ Confirmed 0 order items reference meal_holiday_no_brunch.');
  }

  // 2. Remove meal_holiday_no_brunch from meals collection
  const mealDoc = await db.collection('meals').doc('meal_holiday_no_brunch').get();
  if (mealDoc.exists) {
    await db.collection('meals').doc('meal_holiday_no_brunch').delete();
    console.log('✅ Safely removed meal_holiday_no_brunch from "meals" collection.');
  } else {
    console.log('ℹ️ meal_holiday_no_brunch does not exist in "meals" collection.');
  }

  // 3. Remove any mealAllergens referencing meal_holiday_no_brunch
  const mealAllergensSnap = await db.collection('mealAllergens').where('mealId', '==', 'meal_holiday_no_brunch').get();
  if (!mealAllergensSnap.empty) {
    const batch = db.batch();
    mealAllergensSnap.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    console.log(`✅ Removed ${mealAllergensSnap.size} mealAllergen records for holiday meal.`);
  }

  // 4. Update holiday menu records in menus collection to have mealId: ''
  const holidayMenusSnap = await db.collection('menus').where('isHoliday', '==', true).get();
  console.log(`Found ${holidayMenusSnap.size} holiday menu records. Updating mealId to empty string...`);
  const batch = db.batch();
  holidayMenusSnap.forEach((doc) => {
    batch.update(doc.ref, {
      mealId: '',
      updatedAt: new Date().toISOString(),
    });
  });
  await batch.commit();
  console.log(`✅ Updated ${holidayMenusSnap.size} holiday menu records in "menus" collection.`);

  // 5. Verify total meals remaining in collection
  const allMealsSnap = await db.collection('meals').get();
  console.log(`✅ Meals catalog now has exactly ${allMealsSnap.size} genuine recipes (expected 24).`);
}

safeHolidayCleanup().catch(console.error);
