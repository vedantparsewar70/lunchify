import { db } from './firebase-admin';
import { getTodayString, APP_TIMEZONE } from './utils';

/**
 * Student menus are scheduled per date (usually a whole month in advance) and stay bookable
 * on their service date as long as they are active, not a holiday, and before the ordering
 * deadline. Nothing is switched off automatically: reading a menu never mutates it, and only
 * an authorised staff action (publish, edit, disable) changes a menu's state.
 *
 * The Teachers Only menu (teacher_meals) is a separate, permanent catalogue and is never
 * touched by student scheduling.
 */
export interface MenuPublishRecord {
  date: string;
  publishedOn: string;
  publishedAt: string;
  selectedMealIds: string[];
  count: number;
  publishedBy?: string | null;
  source?: string;
}

/** Read-only: the last publication record for a service date, if any. */
export async function getMenuPublishStatus(targetDate: string): Promise<{ record: MenuPublishRecord | null }> {
  const snap = await db.collection('menu_publishes').doc(targetDate).get();
  return { record: snap.exists ? (snap.data() as MenuPublishRecord) : null };
}

/** Audit record of the last explicit staff publication for a service date. */
export async function recordMenuPublication(
  targetDate: string,
  selectedMealIds: string[],
  extra: { publishedBy?: string | null; source?: string } = {}
): Promise<void> {
  const record: MenuPublishRecord = {
    date: targetDate,
    publishedOn: getTodayString(APP_TIMEZONE),
    publishedAt: new Date().toISOString(),
    selectedMealIds,
    count: selectedMealIds.length,
    publishedBy: extra.publishedBy ?? null,
    source: extra.source || 'daily-publish',
  };

  await db.collection('menu_publishes').doc(targetDate).set(record);
}
