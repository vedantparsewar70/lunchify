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

const MAX_CART_LINES = 20;

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
  if (rawItems.length > MAX_CART_LINES) {
    return { ok: false, status: 400, error: 'Too many items in cart' };
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

/** Name typed at guest checkout: 2-80 printable characters, whitespace collapsed. */
export function normalizeTeacherName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 80 || /[\u0000-\u001f\u007f<>]/.test(name)) return null;
  return name;
}

/**
 * Guest teachers order without an account. Each guest order gets a random access token, sent
 * to the browser in an httpOnly cookie scoped to that order; only its SHA-256 hash is stored,
 * in a separate server-only collection so it never appears in order listings.
 */
export const TEACHER_ORDER_ACCESS = 'teacher_order_access';
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidTeacherOrderId(orderId: unknown): orderId is string {
  return typeof orderId === 'string' && ORDER_ID_PATTERN.test(orderId);
}

export function teacherGuestCookieName(orderId: string): string {
  return `sb_tg_${orderId}`;
}

function hashGuestToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createGuestAccessToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashGuestToken(token) };
}

export function readGuestToken(req: Request, orderId: string): string | null {
  const name = teacherGuestCookieName(orderId);
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim() || null;
    }
  }
  return null;
}

export async function hasGuestAccess(orderId: string, token: string | null, firestore: Firestore = db): Promise<boolean> {
  if (!token) return false;
  const snap = await firestore.collection(TEACHER_ORDER_ACCESS).doc(orderId).get();
  const stored = snap.exists ? String(snap.data()?.tokenHash || '') : '';
  const given = hashGuestToken(token);
  return stored.length === given.length && crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(given));
}

/** Staff/admin access rules, or the guest token issued when this order was placed. */
export async function canAccessTeacherOrderRequest(
  user: { id: string; role: string } | null,
  order: { userId?: string | null },
  orderId: string,
  req: Request,
  firestore: Firestore = db
): Promise<boolean> {
  if (canAccessTeacherOrder(user, order)) return true;
  return hasGuestAccess(orderId, readGuestToken(req, orderId), firestore);
}
