import crypto from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { db } from './firebase-admin';
import { categoryMenuDocId } from './menu-stock';
import { getTodayString, APP_TIMEZONE } from './utils';
import type { XlsxSheet } from './xlsx-reader';

/**
 * Monthly student menu import: a spreadsheet with Day, Date, Pre-primary, Primary, Secondary
 * columns becomes one menu document per date and category (menu_<date>_<category>), the same
 * representation the rest of the app already uses.
 *
 * Rules (nothing is invented):
 * - cell text is kept as written (only leading/trailing spaces are dropped);
 * - text containing "holiday" or "vacation" is a holiday, with that exact text as the reason;
 * - a blank cell (not part of a merged range) stays unfilled and is flagged, never bookable;
 * - merged cells apply their value to every cell they cover, as Excel displays them;
 * - weekday/date mismatches, invalid or duplicate dates are errors and block publishing;
 * - new dishes need a price and an explicit allergen decision from staff before publishing.
 */

export const STUDENT_CATEGORIES = ['Pre-primary', 'Primary', 'Secondary'] as const;
export type StudentCategory = (typeof STUDENT_CATEGORIES)[number];

export type MenuCell =
  | { kind: 'MEAL'; dish: string; merged: boolean }
  | { kind: 'HOLIDAY'; reason: string; merged: boolean }
  | { kind: 'BLANK' }
  | { kind: 'INVALID'; value: string };

export interface MonthlyMenuDay {
  row: number;
  date: string | null;
  dayLabel: string;
  weekday: string | null;
  cells: Record<StudentCategory, MenuCell>;
  errors: string[];
}

export interface MenuIssue {
  severity: 'error' | 'warning';
  row?: number;
  date?: string;
  message: string;
}

export interface MonthlyMenuPlan {
  title: string | null;
  month: string | null;
  days: MonthlyMenuDay[];
  issues: MenuIssue[];
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOLIDAY_PATTERN = /holiday|vacation/i;

export function dishKey(dish: string): string {
  return dish.toLowerCase().replace(/\s*\+\s*/g, '+').replace(/\s+/g, ' ').trim();
}

const headerKey = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z]/g, '');

function excelSerialToDate(serial: number): string | null {
  if (!Number.isInteger(serial) || serial < 61 || serial > 2958465) return null;
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
}

function parseDateCell(value: unknown): string | null {
  if (typeof value === 'number') return excelSerialToDate(value);
  const text = String(value ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

function weekdayOf(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** Turns the first worksheet into a validated plan. Pure: no database access. */
export function parseMonthlyMenu(sheet: XlsxSheet): MonthlyMenuPlan {
  const issues: MenuIssue[] = [];
  const valueAt = (row: number, col: number): { value: string | number | undefined; merged: boolean } => {
    const direct = sheet.cells.get(row)?.get(col);
    if (direct !== undefined) return { value: direct, merged: false };
    const merge = sheet.merges.find((m) => row >= m.fromRow && row <= m.toRow && col >= m.fromCol && col <= m.toCol);
    if (merge) return { value: sheet.cells.get(merge.fromRow)?.get(merge.fromCol), merged: true };
    return { value: undefined, merged: false };
  };

  // Header row: must contain Day, Date and the three categories.
  const rowNumbers = Array.from(sheet.cells.keys()).sort((a, b) => a - b);
  let headerRow = -1;
  const columns: Partial<Record<'day' | 'date' | StudentCategory, number>> = {};
  for (const r of rowNumbers) {
    const found: typeof columns = {};
    for (const [c, v] of sheet.cells.get(r)!) {
      const k = headerKey(v);
      if (k === 'day') found.day = c;
      else if (k === 'date') found.date = c;
      else if (k === 'preprimary') found['Pre-primary'] = c;
      else if (k === 'primary') found.Primary = c;
      else if (k === 'secondary') found.Secondary = c;
    }
    if (found.date !== undefined && STUDENT_CATEGORIES.every((cat) => found[cat] !== undefined)) {
      headerRow = r;
      Object.assign(columns, found);
      break;
    }
  }
  if (headerRow < 0) {
    return {
      title: null,
      month: null,
      days: [],
      issues: [{ severity: 'error', message: 'Could not find the header row (Day, Date, Pre-primary, Primary, Secondary).' }],
    };
  }

  const titleCell = rowNumbers.filter((r) => r < headerRow).map((r) => sheet.cells.get(r)!.values().next().value).find(Boolean);
  const days: MonthlyMenuDay[] = [];
  const seenDates = new Map<string, number>();
  const lastRow = rowNumbers[rowNumbers.length - 1];

  for (let r = headerRow + 1; r <= lastRow; r++) {
    const dayRaw = columns.day !== undefined ? valueAt(r, columns.day).value : undefined;
    const dateRaw = valueAt(r, columns.date!).value;
    const catRaw = STUDENT_CATEGORIES.map((cat) => valueAt(r, columns[cat]!));
    if (dayRaw === undefined && dateRaw === undefined && catRaw.every((c) => c.value === undefined)) continue;

    const errors: string[] = [];
    const date = parseDateCell(dateRaw);
    const dayLabel = String(dayRaw ?? '').trim();
    if (!date) errors.push(`Invalid or missing date "${String(dateRaw ?? '')}"`);
    const weekday = date ? weekdayOf(date) : null;
    if (date && dayLabel) {
      const label = dayLabel.toLowerCase();
      if (label.length < 3 || !weekday!.toLowerCase().startsWith(label)) {
        errors.push(`"${dayLabel}" does not match ${date}, which is a ${weekday}`);
      }
    }
    if (date && seenDates.has(date)) errors.push(`Duplicate date ${date} (also on row ${seenDates.get(date)})`);
    if (date && !seenDates.has(date)) seenDates.set(date, r);

    const cells = {} as Record<StudentCategory, MenuCell>;
    STUDENT_CATEGORIES.forEach((cat, i) => {
      const { value, merged } = catRaw[i];
      if (value === undefined || String(value).trim() === '') {
        cells[cat] = { kind: 'BLANK' };
      } else if (typeof value !== 'string') {
        cells[cat] = { kind: 'INVALID', value: String(value) };
        errors.push(`${cat}: unsupported value "${String(value)}"`);
      } else if (HOLIDAY_PATTERN.test(value)) {
        cells[cat] = { kind: 'HOLIDAY', reason: value.trim(), merged };
      } else {
        cells[cat] = { kind: 'MEAL', dish: value.trim(), merged };
      }
    });

    days.push({ row: r, date, dayLabel, weekday, cells, errors });
    for (const message of errors) issues.push({ severity: 'error', row: r, date: date || undefined, message });
    for (const cat of STUDENT_CATEGORIES) {
      if (cells[cat].kind === 'BLANK') {
        issues.push({ severity: 'warning', row: r, date: date || undefined, message: `${cat} has no entry; it will stay unbookable until staff fill it in.` });
      }
    }
  }

  // Month: every date must fall in one month; calendar days missing from the sheet are flagged.
  const months = new Set(days.map((d) => d.date?.slice(0, 7)).filter(Boolean) as string[]);
  const month = months.size === 1 ? Array.from(months)[0] : null;
  if (months.size > 1) issues.push({ severity: 'error', message: `The sheet mixes dates from several months (${Array.from(months).join(', ')}).` });
  if (days.length === 0) issues.push({ severity: 'error', message: 'No menu rows were found under the header.' });
  if (month) {
    const [y, m] = month.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      if (!seenDates.has(date)) issues.push({ severity: 'warning', date, message: `${date} is not listed in the sheet; no menu will exist for it.` });
    }
  }

  return { title: typeof titleCell === 'string' ? titleCell.trim() : null, month, days, issues };
}

// ---------------------------------------------------------------------------------------------
// Applying a plan to the database
// ---------------------------------------------------------------------------------------------

export interface NewDishInput {
  price?: number | string;
  isVegetarian?: boolean;
  /** Comma-separated allergens, as staff typed them. */
  allergens?: string;
  /** Staff confirm the dish contains none of the listed allergens. */
  noAllergens?: boolean;
}

export interface ImportOptions {
  dishes?: Record<string, NewDishInput>;
  /** Replace existing menus that differ from the sheet, but only where no orders exist. */
  replaceUnordered?: boolean;
  actorId: string;
  fileName?: string;
  /** Preview computes everything without writing. */
  dryRun?: boolean;
}

export type CellOutcome =
  | 'create'
  | 'unchanged'
  | 'replace'
  | 'conflict-has-orders'
  | 'conflict-differs'
  | 'skip-past'
  | 'skip-blank'
  | 'skip-error';

export interface DishSummary {
  key: string;
  name: string;
  mealId: string;
  existing: boolean;
  price: number | null;
  allergens: string | null;
  isVegetarian: boolean | null;
  dates: string[];
  categories: StudentCategory[];
  problems: string[];
}

export interface ImportResult {
  ok: boolean;
  month: string | null;
  title: string | null;
  issues: MenuIssue[];
  days: Array<{
    row: number;
    date: string | null;
    dayLabel: string;
    weekday: string | null;
    errors: string[];
    cells: Record<StudentCategory, MenuCell & { outcome: CellOutcome; existingMealName?: string | null }>;
  }>;
  dishes: DishSummary[];
  counts: Record<CellOutcome, number>;
  written: boolean;
  importId?: string;
}

function newMealId(name: string): string {
  const slug = dishKey(name).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  const hash = crypto.createHash('sha1').update(dishKey(name)).digest('hex').slice(0, 6);
  return `meal_${slug}_${hash}`;
}

/**
 * Computes (and unless dryRun, writes) the menus for a plan. Writes happen only when the plan
 * has no errors and every new dish has a valid price and an allergen decision. Existing menus
 * that already have orders are never changed.
 */
export async function applyMonthlyMenu(
  plan: MonthlyMenuPlan,
  options: ImportOptions,
  firestore: Firestore = db
): Promise<ImportResult> {
  const issues = [...plan.issues];
  const todayStr = getTodayString(APP_TIMEZONE);
  const now = new Date().toISOString();

  // Dishes: reuse an existing catalogue meal with the same name, otherwise a new meal.
  const mealsSnap = await firestore.collection('meals').get();
  const mealsByKey = new Map<string, any>();
  for (const d of mealsSnap.docs) {
    const meal = d.data();
    if (meal?.name) mealsByKey.set(dishKey(String(meal.name)), { ...meal, id: meal.id || d.id });
  }

  const dishes = new Map<string, DishSummary>();
  for (const day of plan.days) {
    for (const cat of STUDENT_CATEGORIES) {
      const cell = day.cells[cat];
      if (cell.kind !== 'MEAL') continue;
      const key = dishKey(cell.dish);
      let dish = dishes.get(key);
      if (!dish) {
        const existing = mealsByKey.get(key);
        const input = options.dishes?.[key] || {};
        const price = existing ? Number(existing.price) : Number(input.price);
        const typedAllergens = typeof input.allergens === 'string' ? input.allergens.split(/[,;]/).map((a) => a.trim()).filter(Boolean).join(', ') : '';
        dish = {
          key,
          name: existing?.name || cell.dish,
          mealId: existing?.id || newMealId(cell.dish),
          existing: Boolean(existing),
          price: Number.isFinite(price) && price > 0 ? price : null,
          allergens: existing ? existing.allergens || null : typedAllergens || null,
          isVegetarian: existing ? existing.isVegetarian !== false : typeof input.isVegetarian === 'boolean' ? input.isVegetarian : null,
          dates: [],
          categories: [],
          problems: [],
        };
        if (!existing) {
          if (input.price === undefined || input.price === '' || !(Number(input.price) > 0) || Number(input.price) > 10000) {
            dish.problems.push('Price needed');
          }
          if (!typedAllergens && input.noAllergens !== true) dish.problems.push('Allergens needed (or confirm none)');
          if (typeof input.isVegetarian !== 'boolean') dish.problems.push('Confirm vegetarian or not');
        } else if (!(dish.price && dish.price > 0)) {
          dish.problems.push('Existing meal has no valid price; set it in Meals first');
        }
        dishes.set(key, dish);
      }
      if (day.date && !dish.dates.includes(day.date)) dish.dates.push(day.date);
      if (!dish.categories.includes(cat)) dish.categories.push(cat);
    }
  }

  // Menus per date and category, compared with what is already stored.
  const counts = { create: 0, unchanged: 0, replace: 0, 'conflict-has-orders': 0, 'conflict-differs': 0, 'skip-past': 0, 'skip-blank': 0, 'skip-error': 0 } as Record<CellOutcome, number>;
  const writes: Array<{ id: string; data: Record<string, unknown> }> = [];
  const resultDays: ImportResult['days'] = [];

  for (const day of plan.days) {
    const resultCells = {} as ImportResult['days'][number]['cells'];
    for (const cat of STUDENT_CATEGORIES) {
      const cell = day.cells[cat];
      let outcome: CellOutcome;
      let existingMealName: string | null = null;
      if (day.errors.length > 0 || !day.date || cell.kind === 'INVALID') outcome = 'skip-error';
      else if (cell.kind === 'BLANK') outcome = 'skip-blank';
      else if (day.date < todayStr) outcome = 'skip-past';
      else {
        const id = categoryMenuDocId(day.date, cat);
        const snap = await firestore.collection('menus').doc(id).get();
        const desired =
          cell.kind === 'MEAL'
            ? { mealId: dishes.get(dishKey(cell.dish))!.mealId, isHoliday: false, holidayReason: null }
            : { mealId: '', isHoliday: true, holidayReason: cell.reason };
        if (!snap.exists) {
          outcome = 'create';
        } else {
          const current = snap.data() || {};
          existingMealName = current.mealId ? mealsSnap.docs.find((d) => d.id === current.mealId)?.data()?.name || current.mealId : null;
          const same =
            String(current.mealId || '') === desired.mealId &&
            Boolean(current.isHoliday) === desired.isHoliday &&
            (current.holidayReason || null) === (desired.holidayReason || null);
          if (same) outcome = 'unchanged';
          else {
            const ordered = await firestore.collection('orderItems').where('date', '==', day.date).get();
            const hasOrders = ordered.docs.some((d) => {
              const it = d.data();
              return it.menuId === id || (current.mealId && it.mealId === current.mealId && (!it.studentCategory || it.studentCategory === cat));
            });
            outcome = hasOrders ? 'conflict-has-orders' : options.replaceUnordered ? 'replace' : 'conflict-differs';
          }
        }
        if (outcome === 'create' || outcome === 'replace') {
          writes.push({
            id,
            data: {
              id,
              date: day.date,
              studentCategory: cat,
              ...desired,
              availableQuantity: desired.isHoliday ? 0 : 50,
              maxQuantity: 50,
              orderingDeadline: '08:30',
              isActive: !desired.isHoliday,
              source: 'monthly-import',
              createdAt: now,
              updatedAt: now,
            },
          });
        }
      }
      counts[outcome]++;
      resultCells[cat] = { ...cell, outcome, existingMealName } as any;
    }
    resultDays.push({ row: day.row, date: day.date, dayLabel: day.dayLabel, weekday: day.weekday, errors: day.errors, cells: resultCells });
  }

  for (const c of ['conflict-has-orders', 'conflict-differs'] as const) {
    if (counts[c] > 0) {
      issues.push({
        severity: 'warning',
        message:
          c === 'conflict-has-orders'
            ? `${counts[c]} existing menu entr${counts[c] === 1 ? 'y has' : 'ies have'} orders and differ from the sheet; they are kept as they are.`
            : `${counts[c]} existing menu entr${counts[c] === 1 ? 'y differs' : 'ies differ'} from the sheet (no orders yet). Choose "replace" to update them.`,
      });
    }
  }

  const dishList = Array.from(dishes.values());
  const blocking = issues.some((i) => i.severity === 'error') || dishList.some((d) => d.problems.length > 0);
  const result: ImportResult = {
    ok: !blocking,
    month: plan.month,
    title: plan.title,
    issues,
    days: resultDays,
    dishes: dishList,
    counts,
    written: false,
  };
  if (options.dryRun || blocking) return result;

  // --- Writes (batched) ---
  const ops: Array<(batch: any) => void> = [];
  const usedMealIds = new Set(writes.map((w) => w.data.mealId).filter(Boolean));
  for (const dish of dishList) {
    if (dish.existing || !usedMealIds.has(dish.mealId)) continue;
    const input = options.dishes?.[dish.key] || {};
    ops.push((batch) =>
      batch.set(firestore.collection('meals').doc(dish.mealId), {
        id: dish.mealId,
        name: dish.name,
        description: dish.name,
        category: 'LUNCH',
        price: Math.round(Number(input.price) * 100) / 100,
        isVegetarian: input.isVegetarian === true,
        allergens: dish.allergens,
        ingredients: null,
        calories: null,
        imageUrl: null,
        source: 'monthly-import',
        createdAt: now,
        updatedAt: now,
      })
    );
    for (const allergen of (dish.allergens || '').split(',').map((a) => a.trim()).filter(Boolean)) {
      const allergenId = `alg_${allergen.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
      ops.push((batch) => batch.set(firestore.collection('allergens').doc(allergenId), { id: allergenId, name: allergen }, { merge: true }));
      ops.push((batch) =>
        batch.set(firestore.collection('mealAllergens').doc(`${dish.mealId}_${allergenId}`), {
          id: `${dish.mealId}_${allergenId}`, mealId: dish.mealId, allergenId, createdAt: now,
        })
      );
    }
  }
  for (const w of writes) ops.push((batch) => batch.set(firestore.collection('menus').doc(w.id), w.data));

  const touchedDates = Array.from(new Set(writes.map((w) => String(w.data.date))));
  for (const date of touchedDates) {
    const mealIds = writes.filter((w) => w.data.date === date && w.data.mealId).map((w) => String(w.data.mealId));
    ops.push((batch) =>
      batch.set(firestore.collection('menu_publishes').doc(date), {
        date, publishedOn: todayStr, publishedAt: now, selectedMealIds: Array.from(new Set(mealIds)), count: mealIds.length,
        publishedBy: options.actorId, source: 'monthly-import',
      })
    );
  }

  const importId = `imp_${plan.month || 'unknown'}_${Date.now()}`;
  ops.push((batch) =>
    batch.set(firestore.collection('menu_imports').doc(importId), {
      id: importId, month: plan.month, title: plan.title, fileName: options.fileName || null, importedBy: options.actorId,
      importedAt: now, counts, replaceUnordered: Boolean(options.replaceUnordered),
      newMeals: dishList.filter((d) => !d.existing && usedMealIds.has(d.mealId)).map((d) => d.mealId),
    })
  );

  for (let i = 0; i < ops.length; i += 400) {
    const batch = firestore.batch();
    ops.slice(i, i + 400).forEach((op) => op(batch));
    await batch.commit();
  }

  return { ...result, written: true, importId };
}
