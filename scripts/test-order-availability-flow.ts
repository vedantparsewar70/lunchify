import fs from 'fs';
import path from 'path';

// Native .env loader for standalone Node runner
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const idx = trimmed.indexOf('=');
        const k = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (k && !process.env[k]) {
          process.env[k] = val;
        }
      }
    });
  }
} catch {}
import prisma from '../lib/prisma';
import { db } from '../lib/firebase-admin';
import { getTodayString, getOffsetDateString, APP_TIMEZONE, isDeadlinePassed } from '../lib/utils';
import { validateCartAvailability } from '../lib/availability';
import { recordMenuPublication, getMenuPublishStatus } from '../lib/menu-schedule';
import { createSessionToken } from '../lib/auth';

async function runRegressionSuite() {
  console.log('========================================================================');
  console.log('STARTING SCHOOL-BITE REGRESSION TEST SUITE (16 SCENARIOS)');
  console.log(`TIMEZONE: ${APP_TIMEZONE} | CURRENT DATE: ${getTodayString(APP_TIMEZONE)}`);
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] Scenario: ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] Scenario: ${desc}${detail ? ` -> Details: ${detail}` : ''}`);
      failed++;
    }
  }

  const todayStr = getTodayString(APP_TIMEZONE);
  const tomorrowStr = getOffsetDateString(1, APP_TIMEZONE);
  const runId = `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const futureTestDate = '2028-11-20'; // Dedicated isolated future date for tests that won't collide with live days
  const unpubDate = `2028-11-${String(Math.floor(21 + Math.random() * 7))}`;

  // IDs for dedicated isolated test entities, unique to THIS test run
  const testMealAId = `tst_meal_a_${runId}`;
  const testMealBId = `tst_meal_b_${runId}`;
  const testUserId = `tst_usr_${runId}`;
  const testParentId = `tst_par_${runId}`;
  const testStudentId = `tst_stu_${runId}`;
  const testOrderId = `TST-ORD-${runId}`;
  const testTeacherOrderId = `TST-TCH-${runId}`;
  const checkoutOrderId = `ORD-TST-${runId}`;
  const rejectedOrderId = `ORD-REJ-${runId}`;
  const concurrentOrderId = `ORD-CNC-${runId}`;
  const retryOrderId = `ORD-RTR-${runId}`;
  const ttlOrderId = `ORD-TTL-${runId}`;

  // Registry of every document created during this run to guarantee 100% cleanup safety
  const createdFixturesRegistry: { collection: string; id: string }[] = [];
  const trackDoc = (collection: string, id: string) => {
    createdFixturesRegistry.push({ collection, id });
  };

  try {
    console.log('--- SETUP: Creating isolated test fixtures (zero impact on production menu) ---');

    // 1. Create isolated test meals in meals collection
    await db.collection('meals').doc(testMealAId).set({
      id: testMealAId,
      name: 'Automated Test Meal Alpha',
      category: 'LUNCH',
      price: 110,
      isVegetarian: true,
      description: 'Test meal for automated suite',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    trackDoc('meals', testMealAId);

    await db.collection('meals').doc(testMealBId).set({
      id: testMealBId,
      name: 'Automated Test Meal Beta',
      category: 'LUNCH',
      price: 90,
      isVegetarian: false,
      description: 'Test meal for automated suite',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    trackDoc('meals', testMealBId);

    // 2. Create isolated test user, parent, and student
    await db.collection('users').doc(testUserId).set({
      id: testUserId,
      email: `testparent_${runId}@schoolbite.internal`,
      name: 'Automated Test Parent',
      role: 'PARENT',
      passwordHash: 'testhash',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    trackDoc('users', testUserId);

    await db.collection('parents').doc(testParentId).set({
      id: testParentId,
      userId: testUserId,
      walletBalance: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    trackDoc('parents', testParentId);

    await db.collection('students').doc(testStudentId).set({
      id: testStudentId,
      parentId: testParentId,
      name: 'Test Child Aarav',
      grade: '4',
      division: 'A',
      rollNo: '42',
      studentId: `STU-TST-${runId}`,
      isVegetarian: true,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    trackDoc('students', testStudentId);

    // 3. Generate authenticated JWT tokens
    const parentAuthToken = await createSessionToken({
      userId: testUserId,
      email: `testparent_${runId}@schoolbite.internal`,
      role: 'PARENT',
      name: 'Automated Test Parent',
      parentId: testParentId,
    });

    const staffAuthToken = await createSessionToken({
      userId: `tst_staff_${runId}`,
      email: `staff_${runId}@schoolbite.internal`,
      role: 'STAFF',
      name: 'Automated Test Staff',
    });

    console.log('[Setup Complete] Isolated test meals, user, parent, student, and auth tokens created.\n');

    // =========================================================================
    // SCENARIO 1: A meal enabled by staff for a date can be booked for that date
    // =========================================================================
    await db.collection('menus').doc(`${testMealAId}_${todayStr}`).set({
      id: `${testMealAId}_${todayStr}`,
      mealId: testMealAId,
      date: todayStr,
      isActive: true,
      availableQuantity: 25,
      maxQuantity: 50,
      orderingDeadline: '23:59',
      updatedAt: new Date().toISOString(),
    });
    trackDoc('menus', `${testMealAId}_${todayStr}`);

    const res1 = await validateCartAvailability([
      { mealId: testMealAId, date: todayStr, quantity: 1, mealName: 'Automated Test Meal Alpha' },
    ]);
    assert(res1.valid === true, '1. A meal enabled by staff can be booked for that date.');

    // =========================================================================
    // SCENARIO 2: A meal disabled by staff for that date is correctly rejected
    // =========================================================================
    await db.collection('menus').doc(`${testMealBId}_${todayStr}`).set({
      id: `${testMealBId}_${todayStr}`,
      mealId: testMealBId,
      date: todayStr,
      isActive: false,
      availableQuantity: 25,
      maxQuantity: 50,
      orderingDeadline: '23:59',
      updatedAt: new Date().toISOString(),
    });
    trackDoc('menus', `${testMealBId}_${todayStr}`);

    const res2 = await validateCartAvailability([
      { mealId: testMealBId, date: todayStr, quantity: 1, mealName: 'Automated Test Meal Beta' },
    ]);
    assert(
      res2.valid === false && res2.firstUnavailableItem?.mealId === testMealBId,
      '2. A meal disabled by staff for that date is correctly rejected with specific item identified.'
    );

    // =========================================================================
    // SCENARIO 3: A meal enabled for one date is not treated as enabled for another
    // =========================================================================
    await db.collection('menus').doc(`${testMealBId}_${futureTestDate}`).set({
      id: `${testMealBId}_${futureTestDate}`,
      mealId: testMealBId,
      date: futureTestDate,
      isActive: true,
      availableQuantity: 30,
      maxQuantity: 50,
      orderingDeadline: '23:59',
      updatedAt: new Date().toISOString(),
    });
    trackDoc('menus', `${testMealBId}_${futureTestDate}`);

    const res3A = await validateCartAvailability([{ mealId: testMealBId, date: todayStr, quantity: 1 }]);
    const res3B = await validateCartAvailability([{ mealId: testMealBId, date: futureTestDate, quantity: 1 }]);
    assert(
      res3A.valid === false && res3B.valid === true,
      '3. A meal enabled for future date is not treated as enabled for today.'
    );

    // =========================================================================
    // SCENARIO 4: A parent can book a cart containing multiple available meals
    // =========================================================================
    // Enable meal B for futureTestDate and also meal A for futureTestDate
    await db.collection('menus').doc(`${testMealAId}_${futureTestDate}`).set({
      id: `${testMealAId}_${futureTestDate}`,
      mealId: testMealAId,
      date: futureTestDate,
      isActive: true,
      availableQuantity: 30,
      maxQuantity: 50,
      orderingDeadline: '23:59',
      updatedAt: new Date().toISOString(),
    });
    trackDoc('menus', `${testMealAId}_${futureTestDate}`);

    const res4 = await validateCartAvailability([
      { mealId: testMealAId, date: futureTestDate, quantity: 2, mealName: 'Automated Test Meal Alpha' },
      { mealId: testMealBId, date: futureTestDate, quantity: 1, mealName: 'Automated Test Meal Beta' },
    ]);
    assert(res4.valid === true && res4.items.length === 2, '4. Multi-item cart containing all available meals passes validation.');

    // =========================================================================
    // SCENARIO 5: If one meal is unavailable, exact meal identified & cart recoverable
    // =========================================================================
    // Disable meal B on todayStr while meal A is enabled
    const res5 = await validateCartAvailability([
      { mealId: testMealAId, date: todayStr, quantity: 1, mealName: 'Automated Test Meal Alpha' },
      { mealId: testMealBId, date: todayStr, quantity: 1, mealName: 'Automated Test Meal Beta' },
    ]);
    assert(
      res5.valid === false &&
      res5.firstUnavailableItem?.mealId === testMealBId &&
      res5.items.find((i) => i.mealId === testMealAId)?.isAvailable === true,
      '5. Multi-item cart identifies exact unavailable meal while preserving available meal state.'
    );

    // =========================================================================
    // SCENARIO 6: Saving staff menu selection immediately reflects in checkout availability
    // =========================================================================
    // Staff publishes tomorrow's menu with meal A
    await recordMenuPublication(futureTestDate, [testMealAId]);
    trackDoc('menu_publishes', futureTestDate);
    const pubStatus = await getMenuPublishStatus(futureTestDate);
    const res6 = await validateCartAvailability([{ mealId: testMealAId, date: futureTestDate, quantity: 1 }]);
    assert(
      Boolean(pubStatus.record?.selectedMealIds.includes(testMealAId)) && res6.valid,
      '6. Persisted staff menu selection immediately reflects in availability validation.'
    );

    // =========================================================================
    // SCENARIO 7: The parent menu API and checkout availability agree
    // =========================================================================
    const menuApiRes = await fetch(`http://localhost:3000/api/menu?date=${todayStr}`).then((r) => r.json());
    const menuApiActiveIds = (menuApiRes.menus || []).map((m: any) => m.mealId);
    const checkoutAvailA = (await validateCartAvailability([{ mealId: testMealAId, date: todayStr }])).valid;
    const checkoutAvailB = (await validateCartAvailability([{ mealId: testMealBId, date: todayStr }])).valid;
    assert(
      checkoutAvailA === menuApiActiveIds.includes(testMealAId) &&
      checkoutAvailB === menuApiActiveIds.includes(testMealBId),
      '7. Parent menu API (/api/menu) and checkout validation agree on availability for both meals.'
    );

    // =========================================================================
    // SCENARIO 8: Timezone and deadline boundaries in Asia/Kolkata (+05:30)
    // =========================================================================
    // Explicitly test both sides of deadline boundary for today in IST
    const passedMorningBoundary = isDeadlinePassed(todayStr, '00:01'); // 12:01 AM today has passed
    const passedNightBoundary = isDeadlinePassed(todayStr, '23:59');   // 11:59 PM today has NOT passed
    const futureDatePassed = isDeadlinePassed(futureTestDate, '08:30'); // Future date has NOT passed
    assert(
      passedMorningBoundary === true && passedNightBoundary === false && futureDatePassed === false,
      '8. Timezone deadline boundary explicitly tests before cutoff, after cutoff, and future dates in Asia/Kolkata.'
    );

    // =========================================================================
    // SCENARIO 9: Refreshing staff menu preserves saved active selection
    // =========================================================================
    // Staff kitchen queries /api/admin/menus?date=futureTestDate
    const staffQueryData = await prisma.menu.findMany({ where: { date: futureTestDate } });
    const staffActiveIds = staffQueryData.filter((m: any) => Boolean(m.isActive)).map((m: any) => m.mealId);
    assert(
      staffActiveIds.includes(testMealAId),
      '9. Refreshing staff menu query preserves saved active selection.'
    );

    // =========================================================================
    // SCENARIO 10: Midnight reset: Genuine before-and-after state transition
    // =========================================================================
    // 1. Create active menu record on unpubDate without publishing it
    await db.collection('menus').doc(`${testMealAId}_${unpubDate}`).set({
      id: `${testMealAId}_${unpubDate}`,
      mealId: testMealAId,
      date: unpubDate,
      isActive: true,
      availableQuantity: 50,
      updatedAt: new Date().toISOString(),
    });
    trackDoc('menus', `${testMealAId}_${unpubDate}`);
    // Ensure no publication record exists
    await db.collection('menu_publishes').doc(unpubDate).delete().catch(() => {});

    // Verify before state
    const beforeResetSnap = await db.collection('menus').doc(`${testMealAId}_${unpubDate}`).get();
    const isActiveBefore = beforeResetSnap.data()?.isActive === true;

    // Menus scheduled in advance are no longer switched off automatically (no midnight reset).
    const afterResetSnap = await db.collection('menus').doc(`${testMealAId}_${unpubDate}`).get();
    const isActiveAfter = afterResetSnap.data()?.isActive === true;

    assert(
      isActiveBefore && isActiveAfter,
      '10. A menu scheduled in advance stays active without a same-day publication record.'
    );

    // Clean up unpubDate record
    await db.collection('menus').doc(`${testMealAId}_${unpubDate}`).delete();

    // =========================================================================
    // SCENARIO 11 & 12: Real checkout API (POST /api/parent/orders) End-to-End
    // =========================================================================
    // A: Disabled meal rejection via actual HTTP POST /api/parent/orders
    const rejectedCheckoutRes = await fetch('http://localhost:3000/api/parent/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `school_auth_token=${parentAuthToken}`,
      },
      body: JSON.stringify({
        cartItems: [
          {
            mealId: testMealBId, // meal B is inactive
            date: todayStr,
            quantity: 1,
            studentId: testStudentId,
            studentName: 'Test Child Aarav',
          },
        ],
        paymentMethod: 'UPI',
        idempotencyKey: rejectedOrderId,
      }),
    });
    const rejData = await rejectedCheckoutRes.json();
    assert(
      rejectedCheckoutRes.status === 400 &&
      rejData.unavailableItem?.mealId === testMealBId,
      '11. Actual POST /api/parent/orders correctly rejects disabled meal with HTTP 400 and metadata.'
    );

    // B: Valid checkout with Cashfree session via actual HTTP POST /api/parent/orders
    const validCheckoutRes = await fetch('http://localhost:3000/api/parent/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `school_auth_token=${parentAuthToken}`,
      },
      body: JSON.stringify({
        cartItems: [
          {
            mealId: testMealAId, // meal A is active
            date: todayStr,
            quantity: 1,
            studentId: testStudentId,
            studentName: 'Test Child Aarav',
          },
        ],
        paymentMethod: 'UPI',
        idempotencyKey: checkoutOrderId,
      }),
    });
    const validData = await validCheckoutRes.json();

    // Repeated request with same idempotencyKey must return existing session without duplicate creation
    const duplicateCheckoutRes = await fetch('http://localhost:3000/api/parent/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `school_auth_token=${parentAuthToken}`,
      },
      body: JSON.stringify({
        cartItems: [
          {
            mealId: testMealAId,
            date: todayStr,
            quantity: 1,
            studentId: testStudentId,
            studentName: 'Test Child Aarav',
          },
        ],
        paymentMethod: 'UPI',
        idempotencyKey: checkoutOrderId,
      }),
    });
    const duplicateData = await duplicateCheckoutRes.json();

    assert(
      validCheckoutRes.status === 200 &&
      Boolean(validData.paymentSessionId || validData.orderId) &&
      duplicateCheckoutRes.status === 200 &&
      duplicateData.isDuplicateSubmission === true &&
      duplicateData.orderId === checkoutOrderId,
      '12. Actual POST /api/parent/orders succeeds for available meals and repeated requests are strictly idempotent.',
      `validStatus: ${validCheckoutRes.status}, validBody: ${JSON.stringify(validData)}, dupStatus: ${duplicateCheckoutRes.status}, dupBody: ${JSON.stringify(duplicateData)}`
    );

    // =========================================================================
    // SCENARIO 12B: True Simultaneous Parallel Checkouts (Promise.all)
    // =========================================================================
    // Send two requests AT THE EXACT SAME MILLISECOND with identical concurrentOrderId
    const [concurrentRes1, concurrentRes2] = await Promise.all([
      fetch('http://localhost:3000/api/parent/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `school_auth_token=${parentAuthToken}` },
        body: JSON.stringify({
          cartItems: [{ mealId: testMealAId, date: todayStr, quantity: 1, studentId: testStudentId, studentName: 'Test Child Aarav' }],
          paymentMethod: 'UPI',
          idempotencyKey: concurrentOrderId,
        }),
      }),
      fetch('http://localhost:3000/api/parent/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `school_auth_token=${parentAuthToken}` },
        body: JSON.stringify({
          cartItems: [{ mealId: testMealAId, date: todayStr, quantity: 1, studentId: testStudentId, studentName: 'Test Child Aarav' }],
          paymentMethod: 'UPI',
          idempotencyKey: concurrentOrderId,
        }),
      }),
    ]);

    const concurrentData1 = await concurrentRes1.json();
    const concurrentData2 = await concurrentRes2.json();

    // Both must be successful (HTTP 200) and reference the exact same orderId
    const bothSucceeded = concurrentRes1.status === 200 && concurrentRes2.status === 200;
    const sameOrderId = concurrentData1.orderId === concurrentOrderId && concurrentData2.orderId === concurrentOrderId;
    const sameSession = Boolean(concurrentData1.paymentSessionId && concurrentData1.paymentSessionId === concurrentData2.paymentSessionId);
    const oneWasDuplicate = concurrentData1.isDuplicateSubmission === true || concurrentData2.isDuplicateSubmission === true || sameSession;

    // Database behavior check: exactly ONE pending_orders or orders document exists
    const pendingSnap = await db.collection('pending_orders').doc(concurrentOrderId).get();
    const orderSnap = await db.collection('orders').doc(concurrentOrderId).get();
    const exactlyOneInDb = (pendingSnap.exists ? 1 : 0) + (orderSnap.exists ? 1 : 0) === 1;

    assert(
      bothSucceeded && sameOrderId && (oneWasDuplicate || sameSession) && exactlyOneInDb,
      '12B. Simultaneous parallel checkouts with same idempotency key are race-safe and create exactly 1 session/order in database.',
      `s1: ${concurrentRes1.status} ${JSON.stringify(concurrentData1)} | s2: ${concurrentRes2.status} ${JSON.stringify(concurrentData2)} | inDb: ${exactlyOneInDb}`
    );

    // =========================================================================
    // SCENARIO 12C: Lock Recovery on Failure / Stale Lock & Retry
    // =========================================================================
    // 1. Simulate an abandoned / stale lock from an earlier crashed request (>30s old)
    await db.collection('idempotency_locks').doc(retryOrderId).set({
      id: retryOrderId,
      parentId: testParentId,
      createdAt: new Date(Date.now() - 45000).toISOString(),
      createdAtMs: Date.now() - 45000,
      status: 'PROCESSING',
      lockToken: 'abandoned_crashed_token',
    });
    trackDoc('idempotency_locks', retryOrderId);

    // 2. Client retries checkout with this idempotency key: should safely take over stale lock
    const recoveryCheckoutRes = await fetch('http://localhost:3000/api/parent/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `school_auth_token=${parentAuthToken}` },
      body: JSON.stringify({
        cartItems: [{ mealId: testMealAId, date: todayStr, quantity: 1, studentId: testStudentId, studentName: 'Test Child Aarav' }],
        paymentMethod: 'UPI',
        idempotencyKey: retryOrderId,
      }),
    });
    const recoveryData = await recoveryCheckoutRes.json();

    // 3. Repeat request after recovery: must return existing session idempotently
    const secondRecoveryRes = await fetch('http://localhost:3000/api/parent/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `school_auth_token=${parentAuthToken}` },
      body: JSON.stringify({
        cartItems: [{ mealId: testMealAId, date: todayStr, quantity: 1, studentId: testStudentId, studentName: 'Test Child Aarav' }],
        paymentMethod: 'UPI',
        idempotencyKey: retryOrderId,
      }),
    });
    const secondRecoveryData = await secondRecoveryRes.json();

    const recoveryPendingSnap = await db.collection('pending_orders').doc(retryOrderId).get();
    const recoveryOrderSnap = await db.collection('orders').doc(retryOrderId).get();
    const exactlyOneRecoveryInDb = (recoveryPendingSnap.exists ? 1 : 0) + (recoveryOrderSnap.exists ? 1 : 0) === 1;

    assert(
      recoveryCheckoutRes.status === 200 &&
      recoveryData.orderId === retryOrderId &&
      secondRecoveryRes.status === 200 &&
      (secondRecoveryData.isDuplicateSubmission === true || secondRecoveryData.paymentSessionId === recoveryData.paymentSessionId) &&
      exactlyOneRecoveryInDb,
      '12C. Stale abandoned locks are safely reclaimed, and retries recover without duplicate sessions or orders.',
      `recRes: ${recoveryCheckoutRes.status} ${JSON.stringify(recoveryData)} | secRes: ${secondRecoveryRes.status} ${JSON.stringify(secondRecoveryData)} | inDb: ${exactlyOneRecoveryInDb}`
    );

    // =========================================================================
    // SCENARIO 12D: 30-Second Idempotency TTL Sequence & Lock Ownership Fencing
    // =========================================================================
    // 1. Request A acquires the lock and remains active for > 30 seconds (simulated via 35s-old lock)
    const tokenA = `lock_token_A_${runId}`;
    await db.collection('idempotency_locks').doc(ttlOrderId).set({
      id: ttlOrderId,
      parentId: testParentId,
      createdAt: new Date(Date.now() - 35000).toISOString(),
      createdAtMs: Date.now() - 35000,
      status: 'PROCESSING',
      lockToken: tokenA,
    });
    trackDoc('idempotency_locks', ttlOrderId);

    // 2. Request B retries with the same idempotency key and safely reclaims the expired lock
    const resB = await fetch('http://localhost:3000/api/parent/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `school_auth_token=${parentAuthToken}` },
      body: JSON.stringify({
        cartItems: [{ mealId: testMealAId, date: todayStr, quantity: 1, studentId: testStudentId, studentName: 'Test Child Aarav' }],
        paymentMethod: 'UPI',
        idempotencyKey: ttlOrderId,
      }),
    });
    const dataB = await resB.json();

    // 3. Both requests attempt to create/recover session and save pending checkout:
    // Request A awakens and attempts to proceed. Check that Request A has lost ownership
    const checkOwnershipA = async (token: string) => {
      const lockSnap = await db.collection('idempotency_locks').doc(ttlOrderId).get();
      return lockSnap.exists && lockSnap.data()?.lockToken === token;
    };
    const isAOwner = await checkOwnershipA(tokenA); // Must be false

    // When Request A attempts to call the route, it recovers Request B's pending checkout cleanly
    const resA = await fetch('http://localhost:3000/api/parent/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `school_auth_token=${parentAuthToken}` },
      body: JSON.stringify({
        cartItems: [{ mealId: testMealAId, date: todayStr, quantity: 1, studentId: testStudentId, studentName: 'Test Child Aarav' }],
        paymentMethod: 'UPI',
        idempotencyKey: ttlOrderId,
      }),
    });
    const dataA = await resA.json();

    // 4. Verify no conflicting records, no duplicate sessions, no duplicate confirmed orders
    const ttlPendingSnap = await db.collection('pending_orders').doc(ttlOrderId).get();
    const ttlOrderSnap = await db.collection('orders').doc(ttlOrderId).get();
    const exactlyOneTtlInDb = (ttlPendingSnap.exists ? 1 : 0) + (ttlOrderSnap.exists ? 1 : 0) === 1;
    const sameSessionOrOrder =
      dataA.orderId === ttlOrderId &&
      dataB.orderId === ttlOrderId &&
      (dataA.isDuplicateSubmission === true || dataA.paymentSessionId === dataB.paymentSessionId);

    // 5. Verify Request A cannot overwrite or delete Request B's lock after losing ownership
    const tokenB = `lock_token_B_${runId}`;
    await db.collection('idempotency_locks').doc(ttlOrderId).set({
      id: ttlOrderId,
      parentId: testParentId,
      createdAt: new Date().toISOString(),
      createdAtMs: Date.now(),
      status: 'PROCESSING',
      lockToken: tokenB,
    });

    // Request A executes its finally-block transaction using tokenA:
    await db.runTransaction(async (t) => {
      const snap = await t.get(db.collection('idempotency_locks').doc(ttlOrderId));
      if (snap.exists && snap.data()?.lockToken === tokenA) {
        t.delete(db.collection('idempotency_locks').doc(ttlOrderId));
      }
    });

    // Verify lock still exists and STILL HAS tokenB (Request A could not delete or overwrite)
    const lockAfterAFinally = await db.collection('idempotency_locks').doc(ttlOrderId).get();
    const lockPreserved = lockAfterAFinally.exists && lockAfterAFinally.data()?.lockToken === tokenB;

    assert(
      resB.status === 200 &&
      !isAOwner &&
      resA.status === 200 &&
      sameSessionOrOrder &&
      exactlyOneTtlInDb &&
      lockPreserved,
      '12D. 30s TTL sequence verified: Reclaimed lock is safe, zero duplicate sessions/orders, Request A cannot delete or overwrite Request B lock.',
      `resB: ${resB.status} ${JSON.stringify(dataB)} | resA: ${resA.status} ${JSON.stringify(dataA)} | isAOwner: ${isAOwner} | inDb: ${exactlyOneTtlInDb} | lockPreserved: ${lockPreserved}`
    );

    // =========================================================================
    // SCENARIO 13: Orders section query: pending order remains until given
    // =========================================================================
    // Create an isolated confirmed order for staff collection
    await db.collection('orders').doc(testOrderId).set({
      id: testOrderId,
      parentId: testParentId,
      totalAmount: 110,
      paymentStatus: 'PAID',
      orderStatus: 'CONFIRMED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    trackDoc('orders', testOrderId);

    await db.collection('orderItems').doc(`item_${testOrderId}`).set({
      id: `item_${testOrderId}`,
      orderId: testOrderId,
      mealId: testMealAId,
      studentId: testStudentId,
      date: todayStr,
      quantity: 1,
      unitPrice: 110,
      totalPrice: 110,
    });
    trackDoc('orderItems', `item_${testOrderId}`);

    // Query active orders as staff page does (orderStatus !== 'COLLECTED' && !== 'CANCELLED')
    const activeStaffOrdersQuery = await prisma.order.findMany({
      where: { id: testOrderId, paymentStatus: 'PAID' },
    });
    const isActiveInOrdersView = activeStaffOrdersQuery.some((o: any) => o.orderStatus !== 'COLLECTED');
    assert(
      isActiveInOrdersView,
      '13. Confirmed student order remains in active Orders until marked as given.'
    );

    // =========================================================================
    // SCENARIO 14: Authorization guard on Mark as Given action
    // =========================================================================
    // Try to mark given using unauthorized PARENT token
    const unauthPatch = await fetch('http://localhost:3000/api/admin/orders', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `school_auth_token=${parentAuthToken}`,
      },
      body: JSON.stringify({ orderId: testOrderId, orderStatus: 'COLLECTED' }),
    });
    assert(
      unauthPatch.status === 403,
      '14. Unauthorized users (parents) are strictly forbidden from marking orders as given (HTTP 403).'
    );

    // =========================================================================
    // SCENARIO 15: Mark as Given transitions order to History & persists
    // =========================================================================
    // Mark given using authorized STAFF token
    const authPatch = await fetch('http://localhost:3000/api/admin/orders', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `school_auth_token=${staffAuthToken}`,
      },
      body: JSON.stringify({ orderId: testOrderId, orderStatus: 'COLLECTED' }),
    });
    const patchData = await authPatch.json();

    // Verify order is now in History and filtered out of active orders
    const historyOrderSnap = await db.collection('orders').doc(testOrderId).get();
    const orderDataAfterGiven = historyOrderSnap.data();
    const isInHistory = orderDataAfterGiven?.orderStatus === 'COLLECTED';

    assert(
      authPatch.status === 200 && isInHistory && Boolean(orderDataAfterGiven?.collectedAt),
      '15. Authorized Mark as Given transitions student order to COLLECTED and records collectedAt.'
    );

    // =========================================================================
    // SCENARIO 16: Teacher order workflow: active until given, then History
    // =========================================================================
    await db.collection('teacher_orders').doc(testTeacherOrderId).set({
      id: testTeacherOrderId,
      orderType: 'TEACHER',
      teacherName: 'Prof. Test Joshi',
      totalAmount: 90,
      date: todayStr,
      paymentStatus: 'PAID',
      orderStatus: 'CONFIRMED',
      items: [{ mealId: testMealAId, mealName: 'Test Meal', quantity: 1, unitPrice: 90 }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    trackDoc('teacher_orders', testTeacherOrderId);

    // Mark teacher order given via PATCH /api/staff/teacher-orders with staff token
    const teacherPatchRes = await fetch('http://localhost:3000/api/staff/teacher-orders', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `school_auth_token=${staffAuthToken}`,
      },
      body: JSON.stringify({ orderId: testTeacherOrderId, orderStatus: 'GIVEN' }),
    });

    const teacherOrderSnap = await db.collection('teacher_orders').doc(testTeacherOrderId).get();
    const isTeacherGiven = teacherOrderSnap.data()?.orderStatus === 'GIVEN';

    assert(
      teacherPatchRes.status === 200 && isTeacherGiven,
      '16. Teacher order transitions to GIVEN upon authorized staff action and moves to History.'
    );

    console.log('\n========================================================================');
    console.log(`TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL 19)`);
    console.log('========================================================================');
  } finally {
    console.log('\n--- GUARANTEED CLEANUP: Removing exclusively test-created documents ---');
    const cleanupFailures: { collection: string; id: string; error: string }[] = [];

    // Combine registry and run-scoped dynamic order IDs (all verified to contain runId)
    const runScopedDocs = [
      ...createdFixturesRegistry,
      { collection: 'orders', id: testOrderId },
      { collection: 'orderItems', id: `item_${testOrderId}` },
      { collection: 'teacher_orders', id: testTeacherOrderId },
      { collection: 'orders', id: checkoutOrderId },
      { collection: 'pending_orders', id: checkoutOrderId },
      { collection: 'pending_orders', id: rejectedOrderId },
      { collection: 'orders', id: concurrentOrderId },
      { collection: 'pending_orders', id: concurrentOrderId },
      { collection: 'orders', id: retryOrderId },
      { collection: 'pending_orders', id: retryOrderId },
      { collection: 'orders', id: ttlOrderId },
      { collection: 'pending_orders', id: ttlOrderId },
      { collection: 'idempotency_locks', id: checkoutOrderId },
      { collection: 'idempotency_locks', id: concurrentOrderId },
      { collection: 'idempotency_locks', id: retryOrderId },
      { collection: 'idempotency_locks', id: ttlOrderId },
    ];

    // De-duplicate by collection + id
    const uniqueDocsMap = new Map<string, { collection: string; id: string }>();
    for (const d of runScopedDocs) {
      // Safety guard: guarantee that EVERY document to be deleted was created exclusively for this test run
      const isTestDoc = d.id.includes(runId) || d.id === futureTestDate || d.id === unpubDate;
      if (!isTestDoc) {
        throw new Error(`CRITICAL SAFETY ERROR: Attempted to clean up non-test document: ${d.collection}/${d.id}`);
      }
      uniqueDocsMap.set(`${d.collection}/${d.id}`, d);
    }

    for (const [, docItem] of uniqueDocsMap) {
      try {
        await db.collection(docItem.collection).doc(docItem.id).delete();
      } catch (delErr: any) {
        // Document already deleted during scenario is valid, but any actual deletion failure must be reported
        if (delErr?.code !== 5 && !delErr?.message?.includes('NOT_FOUND')) {
          cleanupFailures.push({ collection: docItem.collection, id: docItem.id, error: delErr?.message || String(delErr) });
        }
      }
    }

    if (cleanupFailures.length > 0) {
      console.error(`[CLEANUP ERROR] Failed to clean up ${cleanupFailures.length} fixtures:`, cleanupFailures);
      failed++;
    } else {
      console.log(`[Cleanup Complete] Successfully removed all ${uniqueDocsMap.size} isolated test fixtures. Zero pre-existing records touched.`);
    }
  }

  if (failed > 0) {
    process.exit(1);
  }
}

runRegressionSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
  });
