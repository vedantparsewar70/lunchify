import assert from 'assert';
import prisma from '../lib/prisma';
import { OCTOBER_2026_TIMETABLE, getStudentCategory } from '../lib/october-2026-timetable';
import { validateCartAvailability } from '../lib/availability';

async function main() {
  console.log('🧪 Starting School-Bite October 2026 Comprehensive Verification Suite...\n');

  // 1. Verify all 31 dates exist in database
  console.log('--- 1. Database Timetable Coverage Check ---');
  const allOctMenus = await prisma.menu.findMany({
    where: {
      date: {
        gte: '2026-10-01',
        lte: '2026-10-31',
      },
    },
    include: { meal: true },
  });

  console.log(`Found ${allOctMenus.length} total menu records in October 2026.`);
  assert.strictEqual(allOctMenus.length, 93, 'Expected exactly 93 menus (31 days × 3 categories)');

  // Group by date
  const dateMap = new Map<string, any[]>();
  for (const m of allOctMenus) {
    if (!dateMap.has(m.date)) dateMap.set(m.date, []);
    dateMap.get(m.date)!.push(m);
  }

  assert.strictEqual(dateMap.size, 31, 'Expected all 31 days of October to be present');

  for (const day of OCTOBER_2026_TIMETABLE) {
    const menusForDay = dateMap.get(day.date);
    assert(menusForDay, `Missing menus for date: ${day.date}`);
    assert.strictEqual(menusForDay.length, 3, `Date ${day.date} should have 3 category menus`);

    const pp = menusForDay.find((m) => m.studentCategory?.toLowerCase().includes('pre'));
    const pri = menusForDay.find((m) => m.studentCategory === 'Primary' || m.studentCategory === 'PRIMARY');
    const sec = menusForDay.find((m) => m.studentCategory === 'Secondary' || m.studentCategory === 'SECONDARY');

    assert(pp, `Missing Pre-primary menu for ${day.date}`);
    assert(pri, `Missing Primary menu for ${day.date}`);
    assert(sec, `Missing Secondary menu for ${day.date}`);

    const ppExpected = day.menus['Pre-primary'];
    const priExpected = day.menus['Primary'];
    const secExpected = day.menus['Secondary'];

    // Verify dish names or holiday status
    if (ppExpected.isHoliday) {
      assert(pp.isHoliday, `Pre-primary on ${day.date} must be a holiday`);
    } else {
      assert.strictEqual(pp.meal.name, ppExpected.dish, `Mismatch in Pre-primary dish on ${day.date}`);
    }

    if (priExpected.isHoliday) {
      assert(pri.isHoliday, `Primary on ${day.date} must be a holiday`);
    } else {
      assert.strictEqual(pri.meal.name, priExpected.dish, `Mismatch in Primary dish on ${day.date}`);
    }

    if (secExpected.isHoliday) {
      assert(sec.isHoliday, `Secondary on ${day.date} must be a holiday`);
    } else {
      assert.strictEqual(sec.meal.name, secExpected.dish, `Mismatch in Secondary dish on ${day.date}`);
    }
  }
  console.log('✅ All 31 October days and category menus verified in database!');

  // 2. Specific Exception Date Verification
  console.log('\n--- 2. Specific Exception Dates Verification ---');
  // 10/10/2026: Pre-primary Holiday vs Primary/Secondary Veg Hyderabadi
  const oct10 = dateMap.get('2026-10-10')!;
  const oct10PP = oct10.find((m) => m.studentCategory?.toLowerCase().includes('pre'))!;
  const oct10Pri = oct10.find((m) => m.studentCategory === 'Primary' || m.studentCategory === 'PRIMARY')!;
  assert(oct10PP.isHoliday, '10/10/2026 Pre-primary must be holiday');
  assert(!oct10Pri.isHoliday, '10/10/2026 Primary must NOT be holiday');
  assert.strictEqual(oct10Pri.meal.name, 'Veg Hyderabadi + Chapati + Rice');
  console.log('✅ 10/10/2026: Pre-primary Holiday vs Primary/Secondary Veg Hyderabadi verified');

  // 24/10/2026: Pre-primary Holiday vs Primary/Secondary Lauki Chana
  const oct24 = dateMap.get('2026-10-24')!;
  const oct24PP = oct24.find((m) => m.studentCategory?.toLowerCase().includes('pre'))!;
  const oct24Pri = oct24.find((m) => m.studentCategory === 'Primary' || m.studentCategory === 'PRIMARY')!;
  assert(oct24PP.isHoliday, '24/10/2026 Pre-primary must be holiday');
  assert(!oct24Pri.isHoliday, '24/10/2026 Primary must NOT be holiday');
  assert.strictEqual(oct24Pri.meal.name, 'Lauki Chana + Dal + Chapati + Rice + Pickle');
  console.log('✅ 24/10/2026: Pre-primary Holiday vs Primary/Secondary Lauki Chana verified');

  // 29/10/2026: Pre-primary Veg Cutlet vs Primary/Secondary Green Moong
  const oct29 = dateMap.get('2026-10-29')!;
  const oct29PP = oct29.find((m) => m.studentCategory?.toLowerCase().includes('pre'))!;
  const oct29Pri = oct29.find((m) => m.studentCategory === 'Primary' || m.studentCategory === 'PRIMARY')!;
  assert(!oct29PP.isHoliday && !oct29Pri.isHoliday);
  assert.strictEqual(oct29PP.meal.name, 'Veg Cutlet (Shallow fry) + Banana');
  assert.strictEqual(oct29Pri.meal.name, 'Green Moong + Dal + Chapati + Rice');
  console.log('✅ 29/10/2026: Pre-primary Veg Cutlet vs Primary/Secondary Green Moong verified');

  // 31/10/2026: Pre-primary Holiday vs Primary/Secondary Mix Veg Paratha
  const oct31 = dateMap.get('2026-10-31')!;
  const oct31PP = oct31.find((m) => m.studentCategory?.toLowerCase().includes('pre'))!;
  const oct31Pri = oct31.find((m) => m.studentCategory === 'Primary' || m.studentCategory === 'PRIMARY')!;
  assert(oct31PP.isHoliday, '31/10/2026 Pre-primary must be holiday');
  assert(!oct31Pri.isHoliday, '31/10/2026 Primary must NOT be holiday');
  assert.strictEqual(oct31Pri.meal.name, 'Mix Veg Paratha + Curd + Dalkhichadi');
  console.log('✅ 31/10/2026: Pre-primary Holiday vs Primary/Secondary Mix Veg Paratha verified');

  // 02/10/2026 (Gandhi Jayanti) & 20/10/2026 (Dasara)
  const oct02 = dateMap.get('2026-10-02')!;
  assert(oct02.every((m) => m.isHoliday), 'All 3 categories must be holiday on Oct 2 Gandhi Jayanti');
  const oct20 = dateMap.get('2026-10-20')!;
  assert(oct20.every((m) => m.isHoliday), 'All 3 categories must be holiday on Oct 20 Dasara');
  console.log('✅ Full School Holidays (Oct 2 Gandhi Jayanti, Oct 20 Dasara) verified');

  // 3. User Accounts & Staff/Admin Credentials Check
  console.log('\n--- 3. Staff & Admin Accounts Verification ---');
  const adminUser = await prisma.user.findUnique({ where: { email: 'admin@school.com' } });
  const staffUser = await prisma.user.findUnique({ where: { email: 'staff@school.com' } });
  assert(adminUser, 'Admin account (admin@school.com) must exist');
  assert.strictEqual(adminUser.role, 'ADMIN', 'Admin role must be ADMIN');
  assert(staffUser, 'Staff account (staff@school.com) must exist');
  assert.strictEqual(staffUser.role, 'STAFF', 'Staff role must be STAFF');
  console.log('✅ Admin (admin@school.com) & Staff (staff@school.com) credentials preserved intact');

  // 4. Cart Availability & Ordering Restrictions Simulation
  console.log('\n--- 4. Ordering Rules & Validation Simulation ---');
  // Finding meal ID for Mix Sprout
  const mixSproutMenu = allOctMenus.find((m) => m.date === '2026-10-21' && m.studentCategory?.toLowerCase() === 'primary')!;
  const holidayMenu = allOctMenus.find((m) => m.date === '2026-10-20' && m.studentCategory?.toLowerCase() === 'primary')!;
  const pastMenu = allOctMenus.find((m) => m.date === '2026-10-05' && m.studentCategory?.toLowerCase() === 'primary')!;

  // 4a. Future valid order
  const validCart = [
    {
      mealId: mixSproutMenu.mealId,
      date: '2026-10-21',
      quantity: 1,
      studentId: 'student-primary-1',
      studentName: 'Aarav Patel',
      mealName: mixSproutMenu.meal.name,
      mealPrice: 80,
      studentCategory: 'PRIMARY',
    },
  ];
  const validRes = await validateCartAvailability(validCart as any);
  assert(validRes.valid, `Expected future valid order to pass, got error: ${validRes.errorMessage}`);
  console.log('✅ Valid future meal order successfully approved');

  // 4b. Ordering on Holiday rejected
  const holidayCart = [
    {
      mealId: holidayMenu.mealId,
      date: '2026-10-20',
      quantity: 1,
      studentId: 'student-primary-1',
      studentName: 'Aarav Patel',
      mealName: 'Dasara Holiday',
      mealPrice: 0,
      studentCategory: 'PRIMARY',
    },
  ];
  const holidayRes = await validateCartAvailability(holidayCart as any);
  assert(!holidayRes.valid, 'Ordering on a holiday must be rejected');
  assert(holidayRes.errorMessage?.toLowerCase().includes('holiday') || holidayRes.errorMessage?.toLowerCase().includes('brunch'), `Error message must mention holiday, got: ${holidayRes.errorMessage}`);
  console.log(`✅ Holiday order correctly rejected with: "${holidayRes.errorMessage}"`);

  // 4c. Ordering on Past Date rejected
  const pastCart = [
    {
      mealId: pastMenu.mealId,
      date: '2026-10-05',
      quantity: 1,
      studentId: 'student-primary-1',
      studentName: 'Aarav Patel',
      mealName: pastMenu.meal.name,
      mealPrice: 80,
      studentCategory: 'PRIMARY',
    },
  ];
  const pastRes = await validateCartAvailability(pastCart as any);
  assert(!pastRes.valid, 'Ordering on a past date must be rejected');
  assert(pastRes.errorMessage?.toLowerCase().includes('past'), `Error message must mention past date, got: ${pastRes.errorMessage}`);
  console.log(`✅ Past date order correctly rejected with: "${pastRes.errorMessage}"`);

  // 4d. Cross-category ordering rejected (e.g. Veg Cutlet is Pre-primary only on Oct 29)
  const vegCutletMenu = allOctMenus.find((m) => m.date === '2026-10-29' && m.studentCategory?.toLowerCase().includes('pre'))!;
  const crossCatCart = [
    {
      mealId: vegCutletMenu.mealId,
      date: '2026-10-29',
      quantity: 1,
      studentId: 'student-sec-1',
      studentName: 'Rohan Sharma',
      mealName: vegCutletMenu.meal.name,
      mealPrice: 80,
      studentCategory: 'Secondary',
    },
  ];
  const crossCatRes = await validateCartAvailability(crossCatCart as any);
  assert(!crossCatRes.valid, 'Cross-category ordering must be rejected');
  console.log(`✅ Cross-category order correctly rejected with: "${crossCatRes.errorMessage}"`);

  console.log('\n🎉 ALL 4 VERIFICATION SUITE CHECKS COMPLETED AND PASSED PERFECTLY!\n');
}

main()
  .catch((err) => {
    console.error('❌ Verification failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
