async function verifyLiveStaffProduction() {
  console.log('🧪 VERIFYING LIVE STAFF PRODUCTION ON VERCEL (https://school-bite.vercel.app)...\n');
  const baseUrl = 'https://school-bite.vercel.app';

  // 1. October 14: All 3 categories must return Plain Rice + Soyabean Masala + Chapati + Salad
  console.log('--- 1. October 14, 2026 Verification ---');
  for (const cat of ['Pre-primary', 'Primary', 'Secondary']) {
    const res = await fetch(`${baseUrl}/api/menu?date=2026-10-14&category=${encodeURIComponent(cat)}&cb=${Date.now()}`);
    const data = await res.json();
    const item = data.menus?.[0];
    console.log(`  ${cat}: HTTP ${res.status} | dish: "${item?.meal?.name}" | isHoliday: ${item?.isHoliday} | category: "${item?.studentCategory}"`);
    if (!item?.meal?.name?.toLowerCase().includes('soyabean')) {
      throw new Error(`October 14 mismatch for ${cat}: got "${item?.meal?.name}"`);
    }
  }

  // 2. October 29: Pre-primary Veg Cutlet vs Primary/Secondary Green Moong
  console.log('\n--- 2. October 29, 2026 Verification ---');
  const r29PP = await (await fetch(`${baseUrl}/api/menu?date=2026-10-29&category=Pre-primary&cb=${Date.now()}`)).json();
  const r29Pri = await (await fetch(`${baseUrl}/api/menu?date=2026-10-29&category=Primary&cb=${Date.now()}`)).json();
  const r29Sec = await (await fetch(`${baseUrl}/api/menu?date=2026-10-29&category=Secondary&cb=${Date.now()}`)).json();
  console.log(`  Pre-primary: "${r29PP.menus?.[0]?.meal?.name}"`);
  console.log(`  Primary: "${r29Pri.menus?.[0]?.meal?.name}"`);
  console.log(`  Secondary: "${r29Sec.menus?.[0]?.meal?.name}"`);
  if (!r29PP.menus?.[0]?.meal?.name?.toLowerCase().includes('cutlet')) throw new Error('Oct 29 PP failed');
  if (!r29Pri.menus?.[0]?.meal?.name?.toLowerCase().includes('green moong')) throw new Error('Oct 29 Primary failed');
  if (!r29Sec.menus?.[0]?.meal?.name?.toLowerCase().includes('green moong')) throw new Error('Oct 29 Secondary failed');

  // 3. Saturday Split: October 10 (Pre-primary Holiday vs Primary/Secondary Veg Hyderabadi)
  console.log('\n--- 3. October 10, 2026 (Saturday Split) Verification ---');
  const r10PP = await (await fetch(`${baseUrl}/api/menu?date=2026-10-10&category=Pre-primary&cb=${Date.now()}`)).json();
  const r10Pri = await (await fetch(`${baseUrl}/api/menu?date=2026-10-10&category=Primary&cb=${Date.now()}`)).json();
  const r10Sec = await (await fetch(`${baseUrl}/api/menu?date=2026-10-10&category=Secondary&cb=${Date.now()}`)).json();
  console.log(`  Pre-primary Holiday: isHoliday=${r10PP.menus?.[0]?.isHoliday} | reason="${r10PP.menus?.[0]?.holidayReason}"`);
  console.log(`  Primary Dish: "${r10Pri.menus?.[0]?.meal?.name}" | isHoliday=${r10Pri.menus?.[0]?.isHoliday}`);
  console.log(`  Secondary Dish: "${r10Sec.menus?.[0]?.meal?.name}" | isHoliday=${r10Sec.menus?.[0]?.isHoliday}`);
  if (!r10PP.menus?.[0]?.isHoliday) throw new Error('Oct 10 PP must be holiday');
  if (r10Pri.menus?.[0]?.isHoliday) throw new Error('Oct 10 Primary must NOT be holiday');
  if (!r10Pri.menus?.[0]?.meal?.name?.toLowerCase().includes('hyderabadi')) throw new Error('Oct 10 Primary dish mismatch');

  // 4. Full School Holiday: October 2 (Gandhi Jayanti) & October 20 (Dasara)
  console.log('\n--- 4. Full School Holiday Verification ---');
  const r02 = await (await fetch(`${baseUrl}/api/menu?date=2026-10-02&category=Primary&cb=${Date.now()}`)).json();
  const r20 = await (await fetch(`${baseUrl}/api/menu?date=2026-10-20&category=Primary&cb=${Date.now()}`)).json();
  console.log(`  Oct 2 Gandhi Jayanti: isHoliday=${r02.menus?.[0]?.isHoliday} | reason="${r02.menus?.[0]?.holidayReason}"`);
  console.log(`  Oct 20 Dasara: isHoliday=${r20.menus?.[0]?.isHoliday} | reason="${r20.menus?.[0]?.holidayReason}"`);
  if (!r02.menus?.[0]?.isHoliday) throw new Error('Oct 2 must be holiday');
  if (!r20.menus?.[0]?.isHoliday) throw new Error('Oct 20 must be holiday');

  // 5. Staff Kitchen Page Route HTML check
  console.log('\n--- 5. Staff Kitchen Page Route Check ---');
  const staffPageRes = await fetch(`${baseUrl}/staff/kitchen`);
  console.log(`  /staff/kitchen status: HTTP ${staffPageRes.status}`);
  if (staffPageRes.status !== 200) throw new Error('Staff kitchen page failed to load');

  console.log('\n🎉 ALL LIVE PRODUCTION VERIFICATIONS COMPLETED AND PASSED!');
}

verifyLiveStaffProduction()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Check failed:', err.message);
    process.exit(1);
  });
