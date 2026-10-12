import { db } from './firebase-admin';
import { getTodayString, getOffsetDateString, APP_TIMEZONE } from './utils';
import { clearMenuCache } from '@/app/api/menu/route';

export interface MenuPublishRecord {
  date: string;
  publishedOn: string;
  publishedAt: string;
  selectedMealIds: string[];
  count: number;
}

/**
 * Persists an authoritative record that the menu for `targetDate` was
 * explicitly selected and published by staff on today's planning cycle (`publishedOn`).
 */
export async function recordMenuPublication(targetDate: string, selectedMealIds: string[]): Promise<void> {
  const todayStr = getTodayString(APP_TIMEZONE);
  const now = new Date().toISOString();

  const record: MenuPublishRecord = {
    date: targetDate,
    publishedOn: todayStr,
    publishedAt: now,
    selectedMealIds,
    count: selectedMealIds.length,
  };

  await db.collection('menu_publishes').doc(targetDate).set(record);
}

/**
 * Checks if the menu for `targetDate` was published on today's cycle.
 * Tomorrow's menu is ONLY considered published if staff explicitly saved it on today's date.
 */
export async function getMenuPublishStatus(targetDate: string): Promise<{ isPublishedToday: boolean; record: MenuPublishRecord | null }> {
  try {
    const todayStr = getTodayString(APP_TIMEZONE);
    const snap = await db.collection('menu_publishes').doc(targetDate).get();
    if (!snap.exists) {
      return { isPublishedToday: false, record: null };
    }
    const data = snap.data() as MenuPublishRecord;
    const isPublishedToday = data.publishedOn === todayStr && (data.selectedMealIds?.length || 0) > 0;
    return { isPublishedToday, record: data };
  } catch (err) {
    console.error('Error reading menu publish status:', err);
    return { isPublishedToday: false, record: null };
  }
}

/**
 * Core Server-side Reset:
 * Enforces that tomorrow's menu is UNTICKED and INACTIVE unless staff explicitly
 * published it on today's planning cycle.
 * 
 * Works reliably even if browser was closed, laptop was asleep, or server restarted.
 * Does NOT touch today's menu, existing orders, users, or other dates.
 */
export async function ensureTomorrowMenuReset(targetTomorrowDate?: string): Promise<{
  today: string;
  tomorrow: string;
  isPublishedToday: boolean;
  deactivatedCount: number;
}> {
  const todayStr = getTodayString(APP_TIMEZONE);
  const tomorrowStr = targetTomorrowDate || getOffsetDateString(1, APP_TIMEZONE);

  const { isPublishedToday } = await getMenuPublishStatus(tomorrowStr);

  let deactivatedCount = 0;

  // If tomorrow's menu was NOT saved on today's cycle and is not an official timetable date, ensure inactive
  const isOfficialOctoberDate = tomorrowStr.startsWith('2026-10-');
  if (!isPublishedToday && !isOfficialOctoberDate) {
    try {
      const snap = await db.collection('menus')
        .where('date', '==', tomorrowStr)
        .where('isActive', '==', true)
        .get();

      if (!snap.empty) {
        const batch = db.batch();
        snap.docs.forEach((d) => {
          batch.update(d.ref, {
            isActive: false,
            updatedAt: new Date().toISOString(),
          });
          deactivatedCount++;
        });
        await batch.commit();

        try {
          clearMenuCache();
        } catch {
          // ignore cache clear errors
        }
      }
    } catch (err) {
      console.error('Error during automatic tomorrow menu reset check:', err);
    }
  }

  return {
    today: todayStr,
    tomorrow: tomorrowStr,
    isPublishedToday,
    deactivatedCount,
  };
}

// Background scheduler in long-running Node processes (e.g. dev server / container)
let lastCheckedDate = getTodayString(APP_TIMEZONE);
let schedulerStarted = false;

export function initServerMidnightScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const interval = setInterval(async () => {
    try {
      const currentDate = getTodayString(APP_TIMEZONE);
      if (currentDate !== lastCheckedDate) {
        console.log(`[Midnight Rollover in ${APP_TIMEZONE}] Date rolled from ${lastCheckedDate} to ${currentDate}. Running automatic menu reset.`);
        lastCheckedDate = currentDate;
        const result = await ensureTomorrowMenuReset();
        console.log(`[Midnight Rollover] Completed: Tomorrow (${result.tomorrow}) active=${result.isPublishedToday}, deactivated=${result.deactivatedCount}`);
      }
    } catch (err) {
      console.error('[Midnight Rollover] Error during periodic check:', err);
    }
  }, 30000); // Check every 30 seconds

  if (typeof interval?.unref === 'function') {
    interval.unref();
  }
}

// Auto-start in Node runtime
if (typeof window === 'undefined') {
  initServerMidnightScheduler();
}
