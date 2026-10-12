import assert from 'assert';
import prisma from '../lib/prisma';
import { getTodayString, getOffsetDateString } from '../lib/utils';

/**
 * Kitchen Production Counting Logic Verification Suite
 *
 * Rules:
 * 1. Total Orders represents the number of unique orders placed for that date.
 *    One order containing multiple food products or quantities counts as one total order.
 * 2. Each food product displays "QTY TO PREPARE: X" representing the total quantity
 *    ordered for that product on that date.
 * 3. Today's orders and Tomorrow's orders are calculated independently.
 * 4. Ineligible orders (CANCELLED, PENDING, FAILED, REFUNDED, unpaid) are strictly excluded.
 * 5. If a food product has no valid orders for a date, it is not displayed.
 */

// Aggregation logic matching app/api/admin/kitchen/route.ts
function calculateKitchenSummary(items: any[]) {
  const validItems = items.filter((it) => {
    const order = it.order;
    if (!order) return false;
    if (order.orderStatus === 'CANCELLED') return false;
    if (order.paymentStatus !== 'PAID') {
      return false;
    }
    return true;
  });

  const mealCountsMap = new Map<
    string,
    {
      mealId: string;
      mealName: string;
      category: string;
      count: number;
      quantityToPrepare: number;
      orderCount: number;
      orderIds: Set<string>;
    }
  >();

  for (const it of validItems) {
    const existing = mealCountsMap.get(it.mealId);
    if (existing) {
      existing.count += it.quantity;
      existing.quantityToPrepare = existing.count;
      if (it.orderId) existing.orderIds.add(it.orderId);
      existing.orderCount = existing.orderIds.size;
    } else {
      const orderIds = new Set<string>();
      if (it.orderId) orderIds.add(it.orderId);
      mealCountsMap.set(it.mealId, {
        mealId: it.mealId,
        mealName: it.meal.name,
        category: it.meal.category,
        count: it.quantity,
        quantityToPrepare: it.quantity,
        orderCount: orderIds.size || 1,
        orderIds,
      });
    }
  }

  const uniqueOrderIds = new Set(validItems.map((i) => i.orderId).filter(Boolean));
  const mealCountsList = Array.from(mealCountsMap.values())
    .map(({ orderIds, ...rest }) => rest)
    .sort((a, b) => b.count - a.count || b.orderCount - a.orderCount);

  return {
    totalOrders: uniqueOrderIds.size,
    mealCounts: mealCountsList,
  };
}

async function runUnitTests() {
  console.log('🧪 Starting Kitchen Production Unit Logic Tests...\n');

  // Test 1: Multiple students ordering different quantities of same dish
  console.log('--- Test 1: Multiple students ordering different quantities of same dish ---');
  const items1 = [
    {
      orderId: 'ORD-STUDENT-A',
      mealId: 'M-THALI',
      meal: { name: 'Paneer Rice Bowl', category: 'LUNCH' },
      quantity: 5,
      order: { orderStatus: 'CONFIRMED', paymentStatus: 'PAID' },
    },
    {
      orderId: 'ORD-STUDENT-B',
      mealId: 'M-THALI',
      meal: { name: 'Paneer Rice Bowl', category: 'LUNCH' },
      quantity: 3,
      order: { orderStatus: 'CONFIRMED', paymentStatus: 'PAID' },
    },
  ];

  const res1 = calculateKitchenSummary(items1);
  const thali1 = res1.mealCounts.find((m) => m.mealId === 'M-THALI');
  assert.strictEqual(res1.totalOrders, 2, 'Total Orders must be 2 unique orders');
  assert.strictEqual(thali1?.quantityToPrepare, 8, 'Paneer Rice Bowl Qty to Prepare must be 8 (5 + 3)');
  console.log(`✅ Test 1 Passed: Total Orders = ${res1.totalOrders}, Paneer Rice Bowl QTY TO PREPARE = ${thali1?.quantityToPrepare}`);

  // Test 2: One student order containing multiple food products
  console.log('\n--- Test 2: One student order containing multiple food products ---');
  const items2 = [
    {
      orderId: 'ORD-STUDENT-C',
      mealId: 'M-THALI',
      meal: { name: 'Paneer Rice Bowl', category: 'LUNCH' },
      quantity: 2,
      order: { orderStatus: 'CONFIRMED', paymentStatus: 'PAID' },
    },
    {
      orderId: 'ORD-STUDENT-C',
      mealId: 'M-SANDWICH',
      meal: { name: 'Rajma Chawal Bowl', category: 'LUNCH' },
      quantity: 3,
      order: { orderStatus: 'CONFIRMED', paymentStatus: 'PAID' },
    },
  ];

  const res2 = calculateKitchenSummary(items2);
  const paneer2 = res2.mealCounts.find((m) => m.mealId === 'M-THALI');
  const rajma2 = res2.mealCounts.find((m) => m.mealId === 'M-SANDWICH');
  assert.strictEqual(res2.totalOrders, 1, 'Total Orders must be 1 for a single student order with multiple items');
  assert.strictEqual(paneer2?.quantityToPrepare, 2, 'Paneer Rice Bowl Qty to Prepare must be 2');
  assert.strictEqual(rajma2?.quantityToPrepare, 3, 'Rajma Chawal Bowl Qty to Prepare must be 3');
  console.log(`✅ Test 2 Passed: 1 multi-item order => Total Orders = 1, Paneer Qty = 2, Rajma Qty = 3`);

  // Test 3: Today vs Tomorrow independent summaries
  console.log('\n--- Test 3: Today vs Tomorrow independent calculation ---');
  const todayItems = [
    {
      orderId: 'ORD-TODAY-1',
      date: '2026-10-10',
      mealId: 'M-ALPHA',
      meal: { name: 'Automated Test Meal Alpha', category: 'LUNCH' },
      quantity: 1,
      order: { orderStatus: 'COLLECTED', paymentStatus: 'PAID' },
    },
    {
      orderId: 'ORD-TODAY-2',
      date: '2026-10-10',
      mealId: 'M-PANEER',
      meal: { name: 'Paneer Rice Bowl', category: 'LUNCH' },
      quantity: 2,
      order: { orderStatus: 'COLLECTED', paymentStatus: 'PAID' },
    },
    {
      orderId: 'ORD-TODAY-2',
      date: '2026-10-10',
      mealId: 'M-RAJMA',
      meal: { name: 'Rajma Chawal Bowl', category: 'LUNCH' },
      quantity: 1,
      order: { orderStatus: 'COLLECTED', paymentStatus: 'PAID' },
    },
  ];

  const tomorrowItems = [
    {
      orderId: 'ORD-TOMORROW-1',
      date: '2026-10-11',
      mealId: 'M-PANEER',
      meal: { name: 'Paneer Rice Bowl', category: 'LUNCH' },
      quantity: 4,
      order: { orderStatus: 'CONFIRMED', paymentStatus: 'PAID' },
    },
    {
      orderId: 'ORD-TOMORROW-2',
      date: '2026-10-11',
      mealId: 'M-PANEER',
      meal: { name: 'Paneer Rice Bowl', category: 'LUNCH' },
      quantity: 1,
      order: { orderStatus: 'CONFIRMED', paymentStatus: 'PAID' },
    },
  ];

  const todayRes = calculateKitchenSummary(todayItems);
  const tomorrowRes = calculateKitchenSummary(tomorrowItems);

  assert.strictEqual(todayRes.totalOrders, 2, "Today's Total Orders must be 2");
  assert.strictEqual(todayRes.mealCounts.length, 3, "Today must have 3 food products");
  assert.strictEqual(todayRes.mealCounts.find((m) => m.mealId === 'M-PANEER')?.quantityToPrepare, 2, "Today Paneer Qty must be 2");
  assert.strictEqual(todayRes.mealCounts.find((m) => m.mealId === 'M-RAJMA')?.quantityToPrepare, 1, "Today Rajma Qty must be 1");
  assert.strictEqual(todayRes.mealCounts.find((m) => m.mealId === 'M-ALPHA')?.quantityToPrepare, 1, "Today Alpha Qty must be 1");

  assert.strictEqual(tomorrowRes.totalOrders, 2, "Tomorrow's Total Orders must be 2");
  assert.strictEqual(tomorrowRes.mealCounts.length, 1, "Tomorrow must have 1 food product");
  assert.strictEqual(tomorrowRes.mealCounts[0].quantityToPrepare, 5, "Tomorrow Paneer Qty must be 5 (4 + 1)");

  console.log(`✅ Test 3 Passed: Today Total Orders = ${todayRes.totalOrders}, Tomorrow Total Orders = ${tomorrowRes.totalOrders}, Tomorrow Paneer Qty = ${tomorrowRes.mealCounts[0].quantityToPrepare}`);

  // Test 4: Strict eligibility filtering
  console.log('\n--- Test 4: Strict eligibility filtering ---');
  const items4 = [
    {
      orderId: 'ORD-VALID',
      mealId: 'M-THALI',
      meal: { name: 'Deluxe Veg Thali', category: 'LUNCH' },
      quantity: 1,
      order: { orderStatus: 'CONFIRMED', paymentStatus: 'PAID' },
    },
    {
      orderId: 'ORD-CANCELLED',
      mealId: 'M-THALI',
      meal: { name: 'Deluxe Veg Thali', category: 'LUNCH' },
      quantity: 1,
      order: { orderStatus: 'CANCELLED', paymentStatus: 'PAID' },
    },
    {
      orderId: 'ORD-PENDING',
      mealId: 'M-THALI',
      meal: { name: 'Deluxe Veg Thali', category: 'LUNCH' },
      quantity: 3,
      order: { orderStatus: 'CONFIRMED', paymentStatus: 'PENDING' },
    },
    {
      orderId: 'ORD-FAILED',
      mealId: 'M-THALI',
      meal: { name: 'Deluxe Veg Thali', category: 'LUNCH' },
      quantity: 1,
      order: { orderStatus: 'CONFIRMED', paymentStatus: 'FAILED' },
    },
    {
      orderId: 'ORD-REFUNDED',
      mealId: 'M-PASTA',
      meal: { name: 'Creamy Garden Veg Pasta', category: 'LUNCH' },
      quantity: 1,
      order: { orderStatus: 'CONFIRMED', paymentStatus: 'REFUNDED' },
    },
    {
      orderId: 'ORD-ORPHAN',
      mealId: 'M-PASTA',
      meal: { name: 'Creamy Garden Veg Pasta', category: 'LUNCH' },
      quantity: 1,
      order: null,
    },
  ];

  const res4 = calculateKitchenSummary(items4);
  assert.strictEqual(res4.totalOrders, 1, 'Only 1 valid PAID order should be counted');
  assert.strictEqual(res4.mealCounts.length, 1, 'Only meals with valid PAID orders must appear');
  assert.strictEqual(res4.mealCounts[0].quantityToPrepare, 1, 'Meal quantityToPrepare must be 1');
  console.log('✅ Test 4 Passed: Cancelled, Pending, Failed, Refunded, and Orphaned records are strictly excluded');
}

async function runDatabaseVerification() {
  if (process.env.CHECK_DB !== 'true') {
    return;
  }
  console.log('\n📊 Optional Read-Only Live Database Audit...');
  try {
    const today = getTodayString();
    const tomorrow = getOffsetDateString(1);

    console.log(`Auditing database for Today (${today}) and Tomorrow (${tomorrow})...`);

    const todayItems = await prisma.orderItem.findMany({
      where: { date: today },
      include: { meal: true, order: true },
    });
    const todaySummary = calculateKitchenSummary(todayItems);
    console.log(`\nResults for Today (${today}):`);
    console.log(`- Total Orders: ${todaySummary.totalOrders}`);
    for (const m of todaySummary.mealCounts) {
      console.log(`  * ${m.mealName} (${m.category}) — QTY TO PREPARE: ${m.quantityToPrepare}`);
    }

    const tomorrowItems = await prisma.orderItem.findMany({
      where: { date: tomorrow },
      include: { meal: true, order: true },
    });
    const tomorrowSummary = calculateKitchenSummary(tomorrowItems);
    console.log(`\nResults for Tomorrow (${tomorrow}):`);
    console.log(`- Total Orders: ${tomorrowSummary.totalOrders}`);
    for (const m of tomorrowSummary.mealCounts) {
      console.log(`  * ${m.mealName} (${m.category}) — QTY TO PREPARE: ${m.quantityToPrepare}`);
    }

    console.log('\n✅ Read-only database audit completed without modifications.');
  } catch (err: any) {
    console.warn('⚠️ Database audit skipped (database unreachable or unconfigured):', err.message);
  }
}

async function main() {
  await runUnitTests();
  await runDatabaseVerification();
  console.log('\n🎉 ALL KITCHEN PRODUCTION UNIT TESTS PASSED SUCCESSFULLY!');
}

main()
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
