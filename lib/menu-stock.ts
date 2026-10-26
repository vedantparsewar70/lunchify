import type { DocumentData, DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';

/**
 * Category slug used in timetable menu document IDs.
 * Matches scripts/apply-october-2026-menu.ts, e.g. "Pre-primary" -> "pre_primary".
 */
export function menuCategorySlug(category?: string | null): string {
  return String(category || 'all').toLowerCase().replace(/[^a-z0-9]/g, '_');
}

export function categoryMenuDocId(date: string, category?: string | null): string {
  return `menu_${date}_${menuCategorySlug(category)}`;
}

export function normalizeStudentCategory(category?: string | null): string {
  if (!category || category === 'ALL') return 'ALL';
  const c = String(category).toLowerCase();
  if (c.includes('pre')) return 'Pre-primary';
  if (c.includes('sec')) return 'Secondary';
  if (c.includes('pri')) return 'Primary';
  return String(category);
}

function categoryMatches(menuCategory?: string | null, itemCategory?: string | null): boolean {
  const menuCat = normalizeStudentCategory(menuCategory);
  const itemCat = normalizeStudentCategory(itemCategory);
  return menuCat === 'ALL' || itemCat === 'ALL' || menuCat === itemCat;
}

export interface StockLine {
  mealId: string;
  date: string;
  quantity: number;
  studentCategory?: string | null;
  menuId?: string | null;
}

export interface MenuStock {
  ref: DocumentReference;
  menuId: string;
  available: number;
  required: number;
}

/**
 * Finds the menu document backing an order line. Performs transaction reads only.
 * Tries the recorded menuId, the canonical category ID, legacy ID formats, then a query.
 */
export async function resolveMenuInTransaction(
  transaction: Transaction,
  firestore: Firestore,
  line: StockLine
): Promise<{ ref: DocumentReference; data: DocumentData } | null> {
  const menus = firestore.collection('menus');
  const legacyCategoryId = `menu_${line.date}_${String(line.studentCategory || 'all').toLowerCase().replace(/\s+/g, '_')}`;
  const candidateIds = Array.from(
    new Set(
      [line.menuId, categoryMenuDocId(line.date, line.studentCategory), legacyCategoryId, `${line.mealId}_${line.date}`].filter(
        (id): id is string => Boolean(id)
      )
    )
  );

  for (const id of candidateIds) {
    const ref = menus.doc(id);
    const snap = await transaction.get(ref);
    if (!snap.exists) continue;
    const data = snap.data() || {};
    if (data.mealId === line.mealId && (!data.date || data.date === line.date) && categoryMatches(data.studentCategory, line.studentCategory)) {
      return { ref, data };
    }
  }

  const querySnap = await transaction.get(menus.where('mealId', '==', line.mealId).where('date', '==', line.date));
  const match = querySnap.docs.find((d) => categoryMatches(d.data().studentCategory, line.studentCategory));
  return match ? { ref: match.ref, data: match.data() } : null;
}

/**
 * Resolves every line to its menu document and sums the quantity needed per document,
 * so several cart lines for the same menu are checked against stock together.
 * Performs transaction reads only; callers must do this before any transaction write.
 */
export async function collectMenuStockInTransaction(
  transaction: Transaction,
  firestore: Firestore,
  lines: StockLine[]
): Promise<{ stock: MenuStock[]; lineMenuIds: (string | null)[]; unresolved: StockLine[] }> {
  const byPath = new Map<string, MenuStock>();
  const lineMenuIds: (string | null)[] = [];
  const unresolved: StockLine[] = [];

  for (const line of lines) {
    const hit = await resolveMenuInTransaction(transaction, firestore, line);
    if (!hit) {
      unresolved.push(line);
      lineMenuIds.push(null);
      continue;
    }
    const entry = byPath.get(hit.ref.path) || {
      ref: hit.ref,
      menuId: hit.ref.id,
      available: Number(hit.data.availableQuantity ?? 0),
      required: 0,
    };
    entry.required += Math.max(0, Number(line.quantity) || 0);
    byPath.set(hit.ref.path, entry);
    lineMenuIds.push(hit.ref.id);
  }

  return { stock: Array.from(byPath.values()), lineMenuIds, unresolved };
}
