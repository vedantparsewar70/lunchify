import fs from 'fs';
import path from 'path';
import { db } from '../lib/firebase-admin';

async function backupDatabase() {
  console.log('📦 Starting safety backup of current Firestore database...');
  const collections = [
    'users',
    'parents',
    'students',
    'studentAllergies',
    'orders',
    'orderItems',
    'payments',
    'meals',
    'menus',
    'menu_publishes',
    'allergies',
    'allergens',
    'mealAllergens',
    'systemSettings',
    'teacher_orders',
    'teacher_meals'
  ];

  const backupData: Record<string, any[]> = {};

  for (const col of collections) {
    const snap = await db.collection(col).get();
    backupData[col] = snap.docs.map((doc) => ({
      _id: doc.id,
      ...doc.data(),
    }));
    console.log(`   - Backed up ${backupData[col].length} records from "${col}"`);
  }

  const backupPath = path.resolve(process.cwd(), 'prisma/backup_pre_october_migration.json');
  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf-8');
  console.log(`✅ Safety backup saved to: ${backupPath}`);
}

backupDatabase().then(() => process.exit(0)).catch(err => {
  console.error('Backup failed:', err);
  process.exit(1);
});
