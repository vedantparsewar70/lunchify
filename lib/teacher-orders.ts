import crypto from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { db } from './firebase-admin';
import { generateId } from './firestore-db';

export interface TeacherOrderItem {
  id: string;
  mealId: string;
  mealName: string;
  category: string;
  isVegetarian: boolean;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export type TeacherCartResult =
  | { ok: true; items: TeacherOrderItem[]; totalAmount: number }
  | { ok: false; status: number; error: string };

/**
 * Prices a teacher cart from the teacher_meals catalog. Only mealId and quantity are read
 * from the client; names, categories and prices always come from the database.
 */
export async function resolveTeacherCart(rawItems: unknown, firestore: Firestore = db): Promise<TeacherCartResult> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, status: 400, error: 'Your cart is empty. Please select food items.' };
  }

  let totalAmount = 0;
  const items: TeacherOrderItem[] = [];

  for (const item of rawItems as any[]) {
    const mealId = String(item?.mealId || '').trim();
    const qty = Number(item?.quantity);

    if (!mealId || !Number.isInteger(qty) || qty <= 0 || qty > 50) {
      return { ok: false, status: 400, error: 'Invalid items or quantities in cart' };
    }

    const mealDoc = await firestore.collection('teacher_meals').doc(mealId).get();
    if (!mealDoc.exists) {
      return { ok: false, status: 400, error: 'One or more meals in your cart are no longer on the menu' };
    }

    const mealData = mealDoc.data() || {};
    if (mealData.isAvailable === false) {
      return { ok: false, status: 400, error: `"${mealData.name || mealId}" is currently unavailable` };
    }

    const unitPrice = Number(mealData.price);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      return { ok: false, status: 500, error: `Price for "${mealData.name || mealId}" is not configured` };
    }

    const itemTotal = Math.round(qty * unitPrice * 100) / 100;
    totalAmount += itemTotal;

    items.push({
      id: generateId('TCI-'),
      mealId,
      mealName: String(mealData.name || mealId),
      category: mealData.category || 'LUNCH',
      isVegetarian: Boolean(mealData.isVegetarian),
      quantity: qty,
      unitPrice,
      totalPrice: itemTotal,
    });
  }

  return { ok: true, items, totalAmount: Math.round(totalAmount * 100) / 100 };
}

/** Unguessable server-generated teacher order ID; the TCH- prefix is used by the webhook router. */
export function generateTeacherOrderId(): string {
  return `TCH-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

/**
 * Teacher orders are visible to admins and to the staff account that placed them.
 * Orders created before ownership was recorded can be read by any staff member,
 * matching what the staff teacher-orders list already shows them.
 */
export function canAccessTeacherOrder(
  user: { id: string; role: string } | null,
  order: { userId?: string | null }
): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  if (user.role !== 'STAFF') return false;
  return !order.userId || order.userId === user.id;
}
