import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

import { getStudentCategory } from '@/lib/october-2026-timetable';
import { effectiveEntries, publishDish, withdrawDish } from '@/lib/menu-publish';

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

    // Same rules as every other menu tool: one dish per date and category (lib/menu-publish.ts).
    // Re-scheduling a dish that is already on the menu keeps its entry and remaining stock unless a
    // quantity is explicitly supplied.
    const target = body.studentCategory || body.category;
    const cat = !target || target === 'ALL' ? 'ALL' : getStudentCategory(undefined, String(target));
    const published = await publishDish({ date, studentCategory: cat, mealId, replace: body.replace, actorId: user.id });
    if (published.status !== 200) return NextResponse.json(published.body, { status: published.status });

    const entryIds = await effectiveEntries(date, cat);
    const edits = {
      ...(availableQuantity !== undefined ? { availableQuantity: Number(availableQuantity) } : {}),
      ...(maxQuantity !== undefined ? { maxQuantity: Number(maxQuantity) } : {}),
      ...(body.orderingDeadline !== undefined ? { orderingDeadline: orderingDeadline || '08:30' } : {}),
    };
    let menu = null;
    for (const id of entryIds) {
      menu = Object.keys(edits).length
        ? await prisma.menu.update({ where: { id }, data: edits, include: { meal: true } })
        : await prisma.menu.findUnique({ where: { id }, include: { meal: true } });
    }

    return NextResponse.json({ success: true, menu }, { status: 201 });
  } catch (error) {
    console.error('Error scheduling menu:', error);
    return NextResponse.json({ error: 'Failed to schedule meal' }, { status: 500 });
  }
}

/** Older batch publish (PATCH, and PUT with selectedMealIds): one dish for all categories, or none. */
async function handleBatchPublish(date: string, selectedMealIds: string[], actorId: string, replace?: unknown) {
  const mealIds = Array.from(new Set(selectedMealIds.filter((id) => typeof id === 'string' && id)));
  if (mealIds.length > 1) {
    return NextResponse.json(
      { error: 'Each class category has one dish per day. Select exactly one dish to publish.', code: 'ONE_DISH_PER_DAY' },
      { status: 400 }
    );
  }
  const result =
    mealIds.length === 1
      ? await publishDish({ date, studentCategory: 'ALL', mealId: mealIds[0], replace, actorId })
      : await withdrawDish({ date, studentCategory: 'ALL', actorId });
  if (result.status !== 200) return NextResponse.json(result.body, { status: result.status });

  try {
    const { recordMenuPublication } = await import('@/lib/menu-schedule');
    await recordMenuPublication(date, mealIds);
  } catch (e) {
    console.error('Failed to record publication in handleBatchPublish:', e instanceof Error ? e.name : e);
  }

  const updatedMenus = await prisma.menu.findMany({
    where: { date },
    include: { meal: true },
  });
  return NextResponse.json({ ...result.body, menus: updatedMenus });
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
      return await handleBatchPublish(date, selectedMealIds, user.id, body.replace);
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

    return await handleBatchPublish(date, selectedMealIds, user.id, body.replace);
  } catch (error) {
    console.error('Error publishing menu:', error);
    return NextResponse.json({ error: 'Failed to publish menu' }, { status: 500 });
  }
}

