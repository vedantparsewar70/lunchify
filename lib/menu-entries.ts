import { categoryMenuDocId, normalizeStudentCategory } from './menu-stock';

/**
 * One menu per date and student category.
 *
 * Menu entries were created by several tools over time: the monthly import and the staff publish box
 * (ID `menu_<date>_<category>`), and older admin tools (ID `<mealId>_<date>`, sometimes for "ALL"
 * categories). Wherever more than one live entry applies to a date and category, every part of the
 * app (parent menu, checkout and publishing) uses the same one, chosen here:
 *   1. live entries only (active, or a holiday);
 *   2. an entry for exactly this category before an "ALL" entry;
 *   3. the standard `menu_<date>_<category>` entry;
 *   4. the most recently updated.
 */
export interface MenuEntryLike {
  id?: string;
  date?: string;
  mealId?: string | null;
  studentCategory?: string | null;
  isActive?: boolean;
  isHoliday?: boolean;
  updatedAt?: unknown;
}

export const isLiveMenuEntry = (m: MenuEntryLike) => Boolean(m.isHoliday) || m.isActive !== false;

export function menuEntryAppliesTo(m: MenuEntryLike, category: string): boolean {
  const menuCat = normalizeStudentCategory(m.studentCategory);
  return menuCat === 'ALL' || menuCat === normalizeStudentCategory(category);
}

const timeOf = (value: unknown) => {
  const t = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''));
  return Number.isFinite(t) ? t : 0;
};

/** Live entries for this date and category, the effective one first. */
export function rankMenuEntries<T extends MenuEntryLike>(entries: T[], date: string, category: string): T[] {
  const cat = normalizeStudentCategory(category);
  const standardId = categoryMenuDocId(date, cat);
  return entries
    .filter((m) => m.date === date && isLiveMenuEntry(m) && menuEntryAppliesTo(m, cat))
    .sort((a, b) => {
      const specific = Number(normalizeStudentCategory(b.studentCategory) === cat) - Number(normalizeStudentCategory(a.studentCategory) === cat);
      if (specific) return specific;
      const standard = Number(b.id === standardId) - Number(a.id === standardId);
      if (standard) return standard;
      const newer = timeOf(b.updatedAt) - timeOf(a.updatedAt);
      if (newer) return newer;
      return String(a.id).localeCompare(String(b.id));
    });
}

/** The menu entry parents see and can order for this date and category, or null. */
export function effectiveMenuEntry<T extends MenuEntryLike>(entries: T[], date: string, category: string): T | null {
  if (normalizeStudentCategory(category) === 'ALL') return null;
  return rankMenuEntries(entries, date, category)[0] ?? null;
}

/**
 * The one entry to show for a date and category: the effective entry, or when nothing is live, the
 * most relevant switched-off entry (shown to parents as "Not available").
 */
export function displayMenuEntry<T extends MenuEntryLike>(entries: T[], date: string, category: string): T | null {
  const live = effectiveMenuEntry(entries, date, category);
  if (live) return live;
  const cat = normalizeStudentCategory(category);
  const offline = entries
    .filter((m) => m.date === date && menuEntryAppliesTo(m, cat))
    .sort(
      (a, b) =>
        Number(normalizeStudentCategory(b.studentCategory) === cat) - Number(normalizeStudentCategory(a.studentCategory) === cat) ||
        timeOf(b.updatedAt) - timeOf(a.updatedAt) ||
        String(a.id).localeCompare(String(b.id))
    );
  return offline[0] ?? null;
}
