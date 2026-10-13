async function pollNewDeployment() {
  console.log('Polling Vercel live deployment for commit d85d78e...');
  const baseUrl = 'https://school-bite.vercel.app';

  for (let i = 0; i < 25; i++) {
    try {
      const url = `${baseUrl}/api/admin/menus?date=2026-10-14&category=PRE_PRIMARY&cb=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      const count = data.menus?.length || 0;
      const firstDish = data.menus?.[0]?.meal?.name;

      console.log(`[Attempt ${i + 1}] HTTP ${res.status} | category=PRE_PRIMARY returned ${count} items (dish: "${firstDish || 'none'}")`);

      if (count > 0 && firstDish && firstDish.toLowerCase().includes('soyabean')) {
        console.log('\n🚀 DEPLOYMENT CONFIRMED: Vercel has successfully deployed commit d85d78e!');
        return true;
      }
    } catch (err: any) {
      console.log(`[Attempt ${i + 1}] Error: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 6000));
  }
  return false;
}

pollNewDeployment()
  .then((success) => process.exit(success ? 0 : 1))
  .catch(() => process.exit(1));
