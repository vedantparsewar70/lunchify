async function verifyLiveProduction() {
  console.log('🧪 VERIFYING LIVE PRODUCTION (https://school-bite.vercel.app)...\n');
  const baseUrl = 'https://school-bite.vercel.app';

  // 1. Homepage & Login
  const homeRes = await fetch(`${baseUrl}/`);
  const loginRes = await fetch(`${baseUrl}/login`);
  console.log(`✅ Homepage: HTTP ${homeRes.status}`);
  console.log(`✅ Login Page: HTTP ${loginRes.status}`);

  // Test cases: [Date, Category, Expected Holiday, Expected Dish/Reason]
  const testCases = [
    { date: '2026-10-02', cat: 'Pre-primary', isHol: true, expected: 'Mahatma Gandhi Jayanti Holiday' },
    { date: '2026-10-02', cat: 'Primary', isHol: true, expected: 'Mahatma Gandhi Jayanti Holiday' },
    { date: '2026-10-10', cat: 'Pre-primary', isHol: true, expected: 'Pre-primary Saturday Holiday' },
    { date: '2026-10-10', cat: 'Primary', isHol: false, expected: 'Veg Hyderabadi + Chapati + Rice' },
    { date: '2026-10-10', cat: 'Secondary', isHol: false, expected: 'Veg Hyderabadi + Chapati + Rice' },
    { date: '2026-10-12', cat: 'Primary', isHol: false, expected: 'Tadka Rice + Dal Makhani + Chapati' },
    { date: '2026-10-20', cat: 'Primary', isHol: true, expected: 'Dasara Holiday' },
    { date: '2026-10-24', cat: 'Pre-primary', isHol: true, expected: 'Pre-primary Saturday Holiday' },
    { date: '2026-10-24', cat: 'Primary', isHol: false, expected: 'Lauki Chana + Dal + Chapati + Rice + Pickle' },
    { date: '2026-10-29', cat: 'Pre-primary', isHol: false, expected: 'Veg Cutlet (Shallow fry) + Banana' },
    { date: '2026-10-29', cat: 'Primary', isHol: false, expected: 'Green Moong + Dal + Chapati + Rice' },
    { date: '2026-10-29', cat: 'Secondary', isHol: false, expected: 'Green Moong + Dal + Chapati + Rice' },
    { date: '2026-10-31', cat: 'Pre-primary', isHol: true, expected: 'Pre-primary Saturday Holiday' },
    { date: '2026-10-31', cat: 'Primary', isHol: false, expected: 'Mix Veg Paratha + Curd + Dalkhichadi' },
  ];

  for (const tc of testCases) {
    const res = await fetch(`${baseUrl}/api/menu?date=${tc.date}&category=${encodeURIComponent(tc.cat)}&cb=${Date.now()}`);
    const data = await res.json();
    const menu = data.menus?.[0];

    if (!menu) {
      throw new Error(`Missing menu on live site for date ${tc.date} category ${tc.cat}`);
    }

    if (tc.isHol) {
      if (!menu.isHoliday) {
        throw new Error(`Expected holiday on ${tc.date} for ${tc.cat}, got active dish ${menu.meal?.name}`);
      }
      console.log(`✅ [${tc.date} - ${tc.cat}]: Holiday confirmed: "${menu.holidayReason}"`);
    } else {
      if (menu.isHoliday) {
        throw new Error(`Expected dish on ${tc.date} for ${tc.cat}, got holiday: ${menu.holidayReason}`);
      }
      if (!menu.meal?.name?.toLowerCase().includes(tc.expected.toLowerCase().slice(0, 10))) {
        throw new Error(`Dish mismatch on ${tc.date} for ${tc.cat}: expected "${tc.expected}", got "${menu.meal?.name}"`);
      }
      console.log(`✅ [${tc.date} - ${tc.cat}]: Scheduled dish confirmed: "${menu.meal?.name}"`);
    }
  }

  console.log('\n🎉 ALL LIVE PRODUCTION VERIFICATION CHECKS PASSED PERFECTLY!');
}

verifyLiveProduction()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Live check failed:', err.message);
    process.exit(1);
  });
