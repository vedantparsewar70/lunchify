import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { cleanDoc } from '@/lib/firestore-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Default initial teacher meals if collection is empty
const DEFAULT_TEACHER_MEALS = [
  {
    id: 'TM-001',
    name: 'Executive Deluxe Veg Thali',
    description: 'Special canteen thali with paneer sabzi, dal tadka, 3 rotis, jeera rice, salad & sweet',
    category: 'LUNCH',
    price: 120,
    isVegetarian: true,
    isAvailable: true,
  },
  {
    id: 'TM-002',
    name: 'Grilled Paneer & Cheese Sandwich',
    description: 'Toasted multi-grain bread stuffed with spiced cottage cheese, peppers and melted cheese',
    category: 'BREAKFAST',
    price: 70,
    isVegetarian: true,
    isAvailable: true,
  },
  {
    id: 'TM-003',
    name: 'South Indian Idli Sambar (4 pcs)',
    description: 'Steaming hot soft idlis served with authentic vegetable sambar and coconut chutney',
    category: 'BREAKFAST',
    price: 60,
    isVegetarian: true,
    isAvailable: true,
  },
  {
    id: 'TM-004',
    name: 'Fresh Sprout Salad Bowl',
    description: 'Healthy sprouted moong, tossed veggies, lemon dressing and roasted peanuts',
    category: 'LUNCH',
    price: 50,
    isVegetarian: true,
    isAvailable: true,
  },
  {
    id: 'TM-005',
    name: 'Hot Masala Chai / Filter Coffee',
    description: 'Freshly brewed aromatic Indian tea or South Indian filter coffee',
    category: 'BEVERAGE',
    price: 25,
    isVegetarian: true,
    isAvailable: true,
  },
];

const TEACHER_MENU_SEEDED_KEY = 'TEACHER_MENU_SEEDED';

export async function GET() {
  try {
    const snap = await db.collection('teacher_meals').get();

    // The default items are a one-time starting point for a brand-new database. Once the teacher
    // menu has existed (marker set), an empty menu means staff removed everything on purpose, and
    // it must stay empty rather than reappear.
    const markerRef = db.collection('systemSettings').doc(TEACHER_MENU_SEEDED_KEY);
    if (snap.empty) {
      const marker = await markerRef.get();
      if (marker.exists) {
        return NextResponse.json({ meals: [] });
      }
      const batch = db.batch();
      const now = new Date().toISOString();
      for (const meal of DEFAULT_TEACHER_MEALS) {
        const ref = db.collection('teacher_meals').doc(meal.id);
        batch.set(ref, cleanDoc({ ...meal, createdAt: now, updatedAt: now }));
      }
      batch.set(markerRef, { key: TEACHER_MENU_SEEDED_KEY, value: 'true', updatedAt: now });
      await batch.commit();

      return NextResponse.json({
        meals: DEFAULT_TEACHER_MEALS.filter((m) => m.isAvailable),
      });
    }
    if (!(await markerRef.get()).exists) {
      await markerRef.set({ key: TEACHER_MENU_SEEDED_KEY, value: 'true', updatedAt: new Date().toISOString() });
    }

    const meals = snap.docs
      .map((d) => d.data())
      .filter((m: any) => m.isAvailable !== false)
      .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));

    return NextResponse.json({ meals });
  } catch (error) {
    console.error('Error fetching teacher menu:', error);
    return NextResponse.json({ error: 'Failed to fetch teacher menu' }, { status: 500 });
  }
}
