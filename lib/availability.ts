import prisma from '@/lib/prisma';
import { isDeadlinePassed, APP_TIMEZONE, getTodayString } from '@/lib/utils';

export interface MealItemAvailability {
  mealId: string;
  date: string;
  mealName: string;
  isAvailable: boolean;
  isActive: boolean;
  isDeadlinePassed: boolean;
  availableQuantity: number;
  serverPrice: number;
  reason?: string;
}

export interface CartAvailabilityValidation {
  valid: boolean;
  items: MealItemAvailability[];
  firstUnavailableItem?: MealItemAvailability | null;
  errorMessage?: string | null;
}

/**
 * Single authoritative server-side availability check.
 * Evaluates whether requested meals are currently bookable for their target dates.
 *
 * Rules:
 * 1. Meal must exist in the meal catalog.
 * 2. Date must be valid format (YYYY-MM-DD) and not in the past.
 * 3. Quantity must be a valid positive integer (1-20).
 * 4. Menu record must exist for the (mealId, date) combination and have `isActive === true`.
 * 5. `availableQuantity` must be > 0 and sufficient for the requested portion.
 * 6. The ordering deadline for that date must not have passed in Asia/Kolkata timezone.
 */
export async function validateCartAvailability(
  cartItems: Array<{
    mealId: string;
    date: string;
    quantity?: number;
    mealName?: string;
  }>
): Promise<CartAvailabilityValidation> {
  if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
    return {
      valid: false,
      items: [],
      firstUnavailableItem: null,
      errorMessage: 'Cart is empty',
    };
  }

  const todayStr = getTodayString(APP_TIMEZONE);
  const mealIds = Array.from(new Set(cartItems.map((it) => it.mealId).filter(Boolean)));
  const dates = Array.from(new Set(cartItems.map((it) => it.date).filter(Boolean)));

  // 1. Fetch meal catalog records
  const meals = await prisma.meal.findMany({
    where: { id: { in: mealIds } },
  });
  const mealsMap = new Map(meals.map((m: any) => [m.id, m]));

  // 2. Fetch date-specific menu entries for all requested dates
  const dateMenuRecords = await prisma.menu.findMany({
    where: {
      date: { in: dates },
    },
  });

  const normalizeCat = (cat?: string) => {
    if (!cat || cat === 'ALL') return 'ALL';
    const c = String(cat).toLowerCase();
    if (c.includes('pre')) return 'Pre-primary';
    if (c.includes('sec')) return 'Secondary';
    if (c.includes('pri')) return 'Primary';
    return cat;
  };

  const itemResults: MealItemAvailability[] = [];

  for (const item of cartItems) {
    const meal = mealsMap.get(item.mealId);
    const mealName = meal?.name || item.mealName || 'Selected Meal';
    const serverPrice = Number(meal?.price || 0);

    // Validate date format & past date
    if (!item.date || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
      itemResults.push({
        mealId: item.mealId,
        date: item.date || '',
        mealName,
        isAvailable: false,
        isActive: false,
        isDeadlinePassed: false,
        availableQuantity: 0,
        serverPrice,
        reason: 'Invalid meal date format.',
      });
      continue;
    }

    if (item.date < todayStr) {
      itemResults.push({
        mealId: item.mealId,
        date: item.date,
        mealName,
        isAvailable: false,
        isActive: false,
        isDeadlinePassed: true,
        availableQuantity: 0,
        serverPrice,
        reason: 'Meal date cannot be in the past.',
      });
      continue;
    }

    // Validate quantity
    const rawQty = item.quantity !== undefined ? Number(item.quantity) : 1;
    if (isNaN(rawQty) || rawQty <= 0 || !Number.isInteger(rawQty) || rawQty > 20) {
      itemResults.push({
        mealId: item.mealId,
        date: item.date,
        mealName,
        isAvailable: false,
        isActive: false,
        isDeadlinePassed: false,
        availableQuantity: 0,
        serverPrice,
        reason: 'Quantity must be a valid whole number between 1 and 20.',
      });
      continue;
    }

    const itemCat = normalizeCat((item as any).studentCategory);

    // Reject holiday items explicitly
    if (item.mealId === 'meal_holiday_no_brunch' || mealName.toLowerCase().includes('holiday')) {
      itemResults.push({
        mealId: item.mealId,
        date: item.date,
        mealName,
        isAvailable: false,
        isActive: false,
        isDeadlinePassed: false,
        availableQuantity: 0,
        serverPrice: 0,
        reason: 'A holiday is not a meal item and cannot be ordered.',
      });
      continue;
    }

    // Check if the target date is a holiday for this student's category
    const holidayRecord = dateMenuRecords.find((m: any) => {
      if (m.date !== item.date || !m.isHoliday) return false;
      const mCat = normalizeCat(m.studentCategory);
      return mCat === 'ALL' || itemCat === 'ALL' || mCat === itemCat;
    });

    if (holidayRecord) {
      itemResults.push({
        mealId: item.mealId,
        date: item.date,
        mealName,
        isAvailable: false,
        isActive: false,
        isDeadlinePassed: false,
        availableQuantity: 0,
        serverPrice: 0,
        reason: holidayRecord.holidayReason
          ? `${holidayRecord.holidayReason} — No Brunch Scheduled.`
          : 'Holiday Today — No Brunch Scheduled.',
      });
      continue;
    }

    if (!meal) {
      itemResults.push({
        mealId: item.mealId,
        date: item.date,
        mealName,
        isAvailable: false,
        isActive: false,
        isDeadlinePassed: false,
        availableQuantity: 0,
        serverPrice: 0,
        reason: 'Meal does not exist in the school menu catalog.',
      });
      continue;
    }

    // Strictly match category-specific menu or universal 'ALL' menu record
    const menuRecord = dateMenuRecords.find((m: any) => {
      if (m.mealId !== item.mealId || m.date !== item.date) return false;
      const mCat = normalizeCat(m.studentCategory);
      return mCat === 'ALL' || itemCat === 'ALL' || mCat === itemCat;
    });

    if (!menuRecord || !menuRecord.isActive) {
      itemResults.push({
        mealId: item.mealId,
        date: item.date,
        mealName,
        isAvailable: false,
        isActive: false,
        isDeadlinePassed: false,
        availableQuantity: menuRecord?.availableQuantity ?? 0,
        serverPrice,
        reason: 'This dish is not available for this date/category.',
      });
      continue;
    }

    const availableQuantity = Number(menuRecord.availableQuantity ?? 0);
    if (availableQuantity <= 0 || availableQuantity < rawQty) {
      itemResults.push({
        mealId: item.mealId,
        date: item.date,
        mealName,
        isAvailable: false,
        isActive: true,
        isDeadlinePassed: false,
        availableQuantity,
        serverPrice,
        reason: availableQuantity <= 0 ? 'Sold out for this date.' : `Only ${availableQuantity} portions remaining.`,
      });
      continue;
    }

    const deadline = menuRecord.orderingDeadline || '08:30';
    const deadlinePassed = isDeadlinePassed(item.date, deadline);

    if (deadlinePassed) {
      itemResults.push({
        mealId: item.mealId,
        date: item.date,
        mealName,
        isAvailable: false,
        isActive: true,
        isDeadlinePassed: true,
        availableQuantity,
        serverPrice,
        reason: `Ordering deadline (${deadline} AM) has passed.`,
      });
      continue;
    }

    itemResults.push({
      mealId: item.mealId,
      date: item.date,
      mealName,
      isAvailable: true,
      isActive: true,
      isDeadlinePassed: false,
      availableQuantity,
      serverPrice,
    });
  }

  const firstUnavailable = itemResults.find((it) => !it.isAvailable) || null;
  const valid = !firstUnavailable;
  const errorMessage = firstUnavailable
    ? `Meal "${firstUnavailable.mealName}" is not available for ${firstUnavailable.date}. ${firstUnavailable.reason} Please update your cart.`
    : null;

  return {
    valid,
    items: itemResults,
    firstUnavailableItem: firstUnavailable,
    errorMessage,
  };
}
