import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

import { ensureTomorrowMenuReset } from '@/lib/menu-schedule';
import { getOffsetDateString, APP_TIMEZONE } from '@/lib/utils';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');
    const category = searchParams.get('category') || searchParams.get('studentCategory');
    const tomorrowStr = getOffsetDateString(1, APP_TIMEZONE);

    if (!date || date === tomorrowStr) {
      await ensureTomorrowMenuReset(tomorrowStr);
    }

    let whereClause: any = date ? { date } : {};
    if (category && category !== 'ALL') {
      whereClause.studentCategory = { in: [category, 'ALL'] };
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
    const user = await getCurrentUser();
    if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
      return NextResponse.json({ error: 'Unauthorized: Admin or Staff access required' }, { status: 403 });
    }

    const body = await req.json();
    const { mealId, date, availableQuantity = 50, maxQuantity = 50, orderingDeadline = '08:30' } = body;

    if (!mealId || !date) {
      return NextResponse.json({ error: 'Meal ID and date are required' }, { status: 400 });
    }

    // Upsert menu item for this meal & date
    const menu = await prisma.menu.upsert({
      where: {
        mealId_date: {
          mealId,
          date,
        },
      },
      update: {
        availableQuantity: Number(availableQuantity),
        maxQuantity: Number(maxQuantity),
        orderingDeadline: orderingDeadline || '08:30',
        isActive: true,
      },
      create: {
        mealId,
        date,
        availableQuantity: Number(availableQuantity),
        maxQuantity: Number(maxQuantity),
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
    const user = await getCurrentUser();
    if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
      return NextResponse.json({ error: 'Unauthorized: Admin or Staff access required' }, { status: 403 });
    }

    const body = await req.json();
    const { id, availableQuantity, maxQuantity, orderingDeadline, isActive, date, selectedMealIds } = body;

    // Handle batch publishing for a given date
    if (date && Array.isArray(selectedMealIds)) {
      return await handleBatchPublish(date, selectedMealIds);
    }

    if (!id) {
      return NextResponse.json({ error: 'Menu ID is required' }, { status: 400 });
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
    const user = await getCurrentUser();
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
    const user = await getCurrentUser();
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

