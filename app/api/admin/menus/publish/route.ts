import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getStudentCategory } from '@/lib/october-2026-timetable';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
      return NextResponse.json({ error: 'Unauthorized: Admin or Staff access required' }, { status: 403 });
    }

    const body = await req.json();
    const { date, selectedMealIds, category, studentCategory } = body;
    const targetCategory = studentCategory || category;

    if (!date || !Array.isArray(selectedMealIds)) {
      return NextResponse.json({ error: 'Date and selectedMealIds array are required' }, { status: 400 });
    }

    const normalizedCat = targetCategory && targetCategory !== 'ALL' ? getStudentCategory(undefined, targetCategory) : undefined;

    // 1. Fetch existing menus for this date (optionally filtered by studentCategory)
    let whereClause: any = { date };
    if (normalizedCat) {
      whereClause.studentCategory = normalizedCat;
    }

    const existingMenus = await prisma.menu.findMany({
      where: whereClause,
    });

    const now = new Date().toISOString();

    // 2. Enable selected meals & disable unselected meals
    const updatePromises: Promise<any>[] = [];

    // Enable existing menus that match selectedMealIds
    for (const item of existingMenus) {
      const shouldBeActive = selectedMealIds.includes(item.mealId);
      if (item.isActive !== shouldBeActive) {
        updatePromises.push(
          prisma.menu.update({
            where: { id: item.id },
            data: { isActive: shouldBeActive, updatedAt: now },
          })
        );
      }
    }

    // If any selectedMealId does not exist at all in existingMenus, create it
    const existingMealIds = new Set(existingMenus.map((m: any) => m.mealId));
    for (const mealId of selectedMealIds) {
      if (!existingMealIds.has(mealId)) {
        updatePromises.push(
          prisma.menu.upsert({
            where: {
              mealId_date: { mealId, date },
            },
            update: { isActive: true, updatedAt: now },
            create: {
              mealId,
              date,
              studentCategory: normalizedCat || 'ALL',
              availableQuantity: 50,
              maxQuantity: 50,
              orderingDeadline: '08:30',
              isActive: true,
              updatedAt: now,
            },
          })
        );
      }
    }

    await Promise.all(updatePromises);

    // Record authoritative publication in menu_publishes collection
    try {
      const { recordMenuPublication } = await import('@/lib/menu-schedule');
      await recordMenuPublication(date, selectedMealIds);
    } catch (e) {
      console.error('Failed to record menu publication:', e);
    }

    // Invalidate menu cache and notify live sync system so parents immediately see updated menu
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
      publishedCount: selectedMealIds.length,
    });
  } catch (error) {
    console.error('Error publishing menu:', error);
    return NextResponse.json({ error: 'Failed to publish menu' }, { status: 500 });
  }
}
