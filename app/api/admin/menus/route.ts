import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

import { getStudentCategory } from '@/lib/october-2026-timetable';

/** Portions must be whole numbers from 0 to 10,000; anything else is rejected, never stored as NaN. */
function invalidQuantity(...values: unknown[]): boolean {
  return values.some((v) => {
    if (v === undefined || v === null) return false;
    const n = Number(v);
    return v === '' || !Number.isInteger(n) || n < 0 || n > 10000;
  });
}

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
      return NextResponse.json({ error: 'Unauthorized: Admin or Staff access required' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');
    const category = searchParams.get('category') || searchParams.get('studentCategory');

    let whereClause: any = date ? { date } : {};
    if (category && category !== 'ALL') {
      const normalizedCat = getStudentCategory(undefined, category);
      whereClause.studentCategory = { in: [normalizedCat, category, 'ALL'] };
    }

    const menus = await prisma.menu.findMany({
      where: whereClause,
      include: { meal: true },
      orderBy: [{ date: 'desc' }, { meal: { name: 'asc' } }],
    });

    return NextResponse.json({ menus });
  } catch (error) {
    console.error('Error fetching admin menus:', error);
    return NextResponse.json({ error: 'Failed to fetch menus' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
      return NextResponse.json({ error: 'Unauthorized: Admin or Staff access required' }, { status: 403 });
    }

    const body = await req.json();
    const { mealId, date, availableQuantity, maxQuantity, orderingDeadline = '08:30' } = body;

    if (!mealId || !date) {
      return NextResponse.json({ error: 'Meal ID and date are required' }, { status: 400 });
    }
    if (invalidQuantity(availableQuantity, maxQuantity)) {
      return NextResponse.json({ error: 'Quantity must be a whole number between 0 and 10000' }, { status: 400 });
    }

    // Upsert menu item for this meal & date. Re-scheduling an existing menu keeps its remaining
    // stock (already reduced by orders) unless a quantity is explicitly supplied.
    const menu = await prisma.menu.upsert({
      where: {
        mealId_date: {
          mealId,
          date,
        },
      },
      update: {
        ...(availableQuantity !== undefined ? { availableQuantity: Number(availableQuantity) } : {}),
        ...(maxQuantity !== undefined ? { maxQuantity: Number(maxQuantity) } : {}),
        orderingDeadline: orderingDeadline || '08:30',
        isActive: true,
      },
      create: {
        mealId,
        date,
        availableQuantity: Number(availableQuantity ?? 50),
        maxQuantity: Number(maxQuantity ?? 50),
        orderingDeadline: orderingDeadline || '08:30',
        isActive: true,
      },
      include: { meal: true },
    });

    try {
      const { notifyMenuUpdated } = await import('@/lib/sync-events');
      await notifyMenuUpdated();
    } catch {
      // non-blocking
    }

    return NextResponse.json({ success: true, menu }, { status: 201 });
  } catch (error) {
    console.error('Error scheduling menu:', error);
    return NextResponse.json({ error: 'Failed to schedule meal' }, { status: 500 });
  }
}

async function handleBatchPublish(date: string, selectedMealIds: string[]) {
  // 1. Fetch all existing menus for this date
  const existingMenus = await prisma.menu.findMany({
    where: { date },
  });

  const existingMealIdMap = new Map(existingMenus.map((m: any) => [m.mealId, m]));

  const now = new Date().toISOString();

  // 2. Enable selected meals (upserting if not yet in database for that date)
  for (const mealId of selectedMealIds) {
    const existing = existingMealIdMap.get(mealId);
    if (existing) {
      await prisma.menu.update({
        where: { id: existing.id },
        data: { isActive: true, updatedAt: now },
      });
    } else {
      await prisma.menu.upsert({
        where: {
          mealId_date: { mealId, date },
        },
        update: { isActive: true, updatedAt: now },
        create: {
          mealId,
          date,
          availableQuantity: 50,
          maxQuantity: 50,
          orderingDeadline: '08:30',
          isActive: true,
          updatedAt: now,
        },
      });
    }
  }

  // 3. Disable any menu items for this date that are NOT in selectedMealIds
  for (const existing of existingMenus) {
    if (!selectedMealIds.includes(existing.mealId)) {
      await prisma.menu.update({
        where: { id: existing.id },
        data: { isActive: false, updatedAt: now },
      });
    }
  }

  try {
    const { recordMenuPublication } = await import('@/lib/menu-schedule');
    await recordMenuPublication(date, selectedMealIds);
  } catch (e) {
    console.error('Failed to record publication in handleBatchPublish:', e);
  }

  try {
    const { clearMenuCache } = await import('@/app/api/menu/route');
    clearMenuCache();
  } catch {
    // ignore
  }

  try {
    const { notifyMenuUpdated } = await import('@/lib/sync-events');
    await notifyMenuUpdated();
  } catch {
    // ignore
  }

  const updatedMenus = await prisma.menu.findMany({
    where: { date },
    include: { meal: true },
  });

  return NextResponse.json({
    success: true,
    message: `Menu for ${date} published successfully with ${selectedMealIds.length} active items.`,
    menus: updatedMenus,
  });
}

export async function PUT(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
      return NextResponse.json({ error: 'Unauthorized: Admin or Staff access required' }, { status: 403 });
    }

    const body = await req.json();
    const { id, availableQuantity, maxQuantity, orderingDeadline, isActive, date, selectedMealIds } = body;

    // Handle batch publishing for a given date (admin only, as in PATCH)
    if (date && Array.isArray(selectedMealIds)) {
      if (user.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
      }
      return await handleBatchPublish(date, selectedMealIds);
    }

    if (!id) {
      return NextResponse.json({ error: 'Menu ID is required' }, { status: 400 });
    }
    if (invalidQuantity(availableQuantity, maxQuantity)) {
      return NextResponse.json({ error: 'Quantity must be a whole number between 0 and 10000' }, { status: 400 });
    }

    const updated = await prisma.menu.update({
      where: { id },
      data: {
        availableQuantity: availableQuantity !== undefined ? Number(availableQuantity) : undefined,
        maxQuantity: maxQuantity !== undefined ? Number(maxQuantity) : undefined,
        orderingDeadline: orderingDeadline !== undefined ? orderingDeadline : undefined,
        isActive: isActive !== undefined ? Boolean(isActive) : undefined,
      },
      include: { meal: true },
    });

    try {
      const { notifyMenuUpdated } = await import('@/lib/sync-events');
      await notifyMenuUpdated();
    } catch {
      // non-blocking
    }

    return NextResponse.json({ success: true, menu: updated });
  } catch (error) {
    console.error('Error updating menu item:', error);
    return NextResponse.json({ error: 'Failed to update menu' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
      return NextResponse.json({ error: 'Unauthorized: Admin or Staff access required' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Menu ID is required' }, { status: 400 });
    }

    await prisma.menu.delete({ where: { id } });

    try {
      const { notifyMenuUpdated } = await import('@/lib/sync-events');
      await notifyMenuUpdated();
    } catch {
      // non-blocking
    }

    return NextResponse.json({ success: true, message: 'Menu item removed successfully' });
  } catch (error) {
    console.error('Error removing menu item:', error);
    return NextResponse.json({ error: 'Failed to remove menu item' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { date, selectedMealIds } = body;

    if (!date || !Array.isArray(selectedMealIds)) {
      return NextResponse.json({ error: 'Date and selectedMealIds array are required' }, { status: 400 });
    }

    return await handleBatchPublish(date, selectedMealIds);
  } catch (error) {
    console.error('Error publishing menu:', error);
    return NextResponse.json({ error: 'Failed to publish menu' }, { status: 500 });
  }
}

