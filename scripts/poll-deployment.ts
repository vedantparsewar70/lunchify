async function pollDeployment() {
  console.log('Checking live production deployment at https://school-bite.vercel.app ...');
  for (let i = 0; i < 20; i++) {
    try {
      const url = `https://school-bite.vercel.app/api/menu?date=2026-10-29&category=Primary&cb=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      const menus = data.menus || [];
      const firstDish = menus[0]?.meal?.name;
      console.log(`[Attempt ${i + 1}] HTTP ${res.status} | Menus: ${menus.length} | First Dish: "${firstDish || 'none'}"`);

      if (firstDish && firstDish.toLowerCase().includes('green moong')) {
        console.log('\n🚀 DEPLOYMENT CONFIRMED: Live production is running the updated commit!');
        return true;
      }
    } catch (err: any) {
      console.log(`[Attempt ${i + 1}] Error: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 6000));
  }
  return false;
}

pollDeployment()
  .then((success) => process.exit(success ? 0 : 1))
  .catch(() => process.exit(1));
