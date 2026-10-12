import { db } from '../lib/firebase-admin';

async function inspect() {
  console.log('=== DATABASE AUDIT ===');
  const collections = [
    'users',
    'parents',
    'students',
    'orders',
    'orderItems',
    'payments',
    'meals',
    'menus',
    'menu_publishes',
    'teacher_orders',
    'teacher_meals'
  ];

  for (const col of collections) {
    const snap = await db.collection(col).get();
    console.log(`\nCollection: "${col}" - Count: ${snap.size}`);
    if (col === 'users') {
      snap.docs.forEach(d => {
        const u = d.data();
        console.log(`  User: ${u.email} | Role: ${u.role} | Name: ${u.name}`);
      });
    } else if (col === 'orders') {
      snap.docs.forEach(d => {
        const o = d.data();
        console.log(`  Order: ${d.id} | ParentId: ${o.parentId} | Total: ${o.totalAmount} | Status: ${o.orderStatus} | Payment: ${o.paymentStatus} | Date: ${o.createdAt}`);
      });
    } else if (col === 'students') {
      snap.docs.forEach(d => {
        const s = d.data();
        console.log(`  Student: ${s.name} | Grade: ${s.grade} | Div: ${s.division} | ID: ${s.studentId} | ParentId: ${s.parentId}`);
      });
    } else if (col === 'meals') {
      snap.docs.forEach(d => {
        const m = d.data();
        console.log(`  Meal [${d.id}]: "${m.name}" | Cat: ${m.category} | Price: ${m.price}`);
      });
    } else if (col === 'menus') {
      console.log(`  Total menus: ${snap.size}`);
      const dates = new Set<string>();
      snap.docs.forEach(d => dates.add(d.data().date));
      console.log(`  Menu dates present:`, Array.from(dates).sort());
    }
  }
}

inspect().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
