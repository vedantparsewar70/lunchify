import type { Firestore } from 'firebase-admin/firestore';
import { db } from './firebase-admin';
import { applyMonthlyMenu, dishKey, STUDENT_CATEGORIES, type MonthlyMenuPlan, type StudentCategory } from './monthly-menu';
import { rankMenuEntries, type MenuEntryLike } from './menu-entries';
import { normalizeStudentCategory } from './menu-stock';

/**
 * The single way to put a catalog dish on the menu for one date: Staff → Kitchen, Admin → Menu and
 * the older menu API all call this, and it runs the monthly import's rules for that day. So every
 * tool keeps one menu per date and student category:
 * - the recipe's own ID and price are used (no new recipe);
 * - entries created by any tool are checked, not just the standard ID;
 * - an entry with orders is never changed;
 * - a different entry without orders is replaced only when `replace` is true (others are switched
 *   off, never deleted);
 * - an entry shared by all categories is only replaced for all categories at once.
 */
export interface PublishDishInput {
  date: unknown;
  /** One category, or 'ALL' for every category. */
  studentCategory: unknown;
  mealId: unknown;
  replace?: unknown;
  actorId: string;
}

export interface PublishDishResult {
  status: number;
  body: Record<string, unknown>;
}

const CATEGORY_LABEL = (cats: StudentCategory[]) => (cats.length === STUDENT_CATEGORIES.length ? 'all categories' : cats.join(', '));

export async function publishDish(input: PublishDishInput, firestore: Firestore = db): Promise<PublishDishResult> {
  const { date, studentCategory, mealId, replace, actorId } = input;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return { status: 400, body: { error: 'Please choose a valid date.' } };
  }
  const categories: StudentCategory[] =
    studentCategory === 'ALL' ? [...STUDENT_CATEGORIES] : STUDENT_CATEGORIES.includes(studentCategory as StudentCategory) ? [studentCategory as StudentCategory] : [];
  if (categories.length === 0) {
    return { status: 400, body: { error: 'Please choose Pre-primary, Primary, Secondary or all categories.' } };
  }
  if (typeof mealId !== 'string' || !mealId) {
    return { status: 400, body: { error: 'Please choose a recipe from the catalog.' } };
  }

  const mealSnap = await firestore.collection('meals').doc(mealId).get();
  const meal = mealSnap.data();
  if (!mealSnap.exists || !meal?.name) {
    return { status: 404, body: { error: 'That recipe is not in the catalog.' } };
  }
  const name = String(meal.name);

  const cells = Object.fromEntries(
    STUDENT_CATEGORIES.map((cat) => [cat, categories.includes(cat) ? { kind: 'MEAL', dish: name, merged: false } : { kind: 'BLANK' }])
  ) as MonthlyMenuPlan['days'][number]['cells'];
  const plan: MonthlyMenuPlan = {
    title: null,
    month: date.slice(0, 7),
    issues: [],
    days: [{ row: 0, date, dayLabel: date, weekday: null, cells, errors: [] }],
  };
  const options = { replaceUnordered: replace === true, actorId, fileName: `manual: ${CATEGORY_LABEL(categories)} ${date}` };

  // Check first: the import matches recipes by name, so it must resolve to exactly this recipe.
  const preview = await applyMonthlyMenu(plan, { ...options, dryRun: true }, firestore);
  const dish = preview.dishes.find((d) => d.key === dishKey(name));
  if (!dish || dish.mealId !== mealId) {
    return { status: 409, body: { error: 'Another catalog recipe has the same name. Rename one of them in the catalog first.' } };
  }
  if (dish.problems.length > 0) {
    return { status: 409, body: { error: `This recipe cannot be published yet: ${dish.problems.join('; ')}.` } };
  }

  const cellsOf = (result: typeof preview) => categories.map((cat) => ({ cat, ...result.days[0].cells[cat] }));
  const planned = cellsOf(preview);
  const where = (outcome: string) => planned.filter((c) => c.outcome === outcome);
  const list = (items: typeof planned) => items.map((c) => `${c.cat}${c.existingMealName ? ` (${c.existingMealName})` : ''}`).join(', ');

  if (where('skip-past').length) return { status: 400, body: { error: 'This date has already passed.' } };
  if (where('conflict-has-orders').length) {
    return {
      status: 409,
      body: { error: `Already ordered, so it cannot be changed: ${list(where('conflict-has-orders'))} on ${date}.`, code: 'HAS_ORDERS' },
    };
  }
  if (where('conflict-shared').length) {
    return {
      status: 409,
      body: {
        error: `${date} has one dish for all categories (${where('conflict-shared')[0].existingMealName}). Publish for all categories to replace it.`,
        code: 'SHARED_ENTRY',
      },
    };
  }
  if (where('conflict-differs').length) {
    const differing = where('conflict-differs');
    return {
      status: 409,
      body: {
        error: `Already on the menu for ${date}: ${list(differing)}. Confirm to replace (no orders yet).`,
        code: 'NEEDS_REPLACE',
        existingMealName: differing[0].existingMealName || null,
      },
    };
  }
  if (planned.every((c) => c.outcome === 'unchanged')) {
    return { status: 200, body: { success: true, outcome: 'unchanged', message: `${name} is already on the menu for ${CATEGORY_LABEL(categories)} on ${date}.` } };
  }
  if (!planned.every((c) => ['create', 'replace', 'unchanged'].includes(c.outcome))) {
    return { status: 400, body: { error: 'This menu could not be updated.' } };
  }

  // The write re-checks everything (an order may have arrived since the check above).
  const result = await applyMonthlyMenu(plan, options, firestore);
  const final = cellsOf(result);
  if (!result.written || !final.every((c) => ['create', 'replace', 'unchanged'].includes(c.outcome))) {
    return { status: 409, body: { error: 'This menu changed meanwhile and was not fully updated. Please refresh and try again.' } };
  }

  try {
    const { notifyMenuUpdated } = await import('./sync-events');
    await notifyMenuUpdated();
  } catch {
    // non-blocking
  }

  const outcome = final.some((c) => c.outcome === 'replace') ? 'replace' : 'create';
  return {
    status: 200,
    body: { success: true, outcome, message: `${name} is now on the menu for ${CATEGORY_LABEL(categories)} on ${date}. Parents can order it.` },
  };
}

/**
 * Stops sales of the dish for one date (one category, or 'ALL'): the live entries are switched off,
 * never deleted, so orders, stock and history stay as they are. A dish shared by all categories can
 * only be switched off for all categories at once.
 */
export async function withdrawDish(
  input: { date: unknown; studentCategory: unknown; actorId: string },
  firestore: Firestore = db
): Promise<PublishDishResult> {
  const { date, studentCategory, actorId } = input;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { status: 400, body: { error: 'Please choose a valid date.' } };
  }
  const all = studentCategory === 'ALL';
  const categories: StudentCategory[] = all
    ? [...STUDENT_CATEGORIES]
    : STUDENT_CATEGORIES.includes(studentCategory as StudentCategory) ? [studentCategory as StudentCategory] : [];
  if (categories.length === 0) {
    return { status: 400, body: { error: 'Please choose Pre-primary, Primary, Secondary or all categories.' } };
  }

  const snap = await firestore.collection('menus').where('date', '==', date).get();
  const entries = snap.docs.map((d) => ({ ...(d.data() as MenuEntryLike), id: d.id }));
  const toSwitchOff = new Map<string, MenuEntryLike & { id: string }>();
  for (const cat of categories) {
    for (const m of rankMenuEntries(entries, date, cat)) {
      if (m.isHoliday) continue;
      if (!all && normalizeStudentCategory(m.studentCategory) === 'ALL') {
        return { status: 409, body: { error: `${date} has one dish for all categories. Switch it off for all categories.`, code: 'SHARED_ENTRY' } };
      }
      toSwitchOff.set(m.id, m);
    }
  }

  const now = new Date().toISOString();
  const batch = firestore.batch();
  for (const id of toSwitchOff.keys()) {
    batch.set(firestore.collection('menus').doc(id), { isActive: false, updatedAt: now, withdrawnBy: actorId }, { merge: true });
  }
  if (toSwitchOff.size > 0) {
    await batch.commit();
    try {
      const { notifyMenuUpdated } = await import('./sync-events');
      await notifyMenuUpdated();
    } catch {
      // non-blocking
    }
  }
  return { status: 200, body: { success: true, outcome: 'withdrawn', withdrawn: toSwitchOff.size, message: `Menu for ${CATEGORY_LABEL(categories)} on ${date} is no longer on sale.` } };
}

/** The menu entries now in effect for the date and categories (to apply quantity/deadline edits). */
export async function effectiveEntries(date: string, studentCategory: unknown, firestore: Firestore = db) {
  const categories = studentCategory === 'ALL' || !studentCategory ? [...STUDENT_CATEGORIES] : [studentCategory as StudentCategory];
  const snap = await firestore.collection('menus').where('date', '==', date).get();
  const entries = snap.docs.map((d) => ({ ...(d.data() as MenuEntryLike), id: d.id }));
  const ids = new Set<string>();
  for (const cat of categories) {
    const entry = rankMenuEntries(entries, date, cat)[0];
    if (entry && !entry.isHoliday) ids.add(entry.id);
  }
  return Array.from(ids);
}
