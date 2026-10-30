import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getStudentCategory } from '@/lib/october-2026-timetable';
import { publishDish, withdrawDish } from '@/lib/menu-publish';

export const dynamic = 'force-dynamic';

/**
 * Admin → Menu "Save & Publish". Each date has one dish per student category, so exactly one dish
 * is published (for the chosen category, or all categories); with none selected the day's dish
 * stops being sold. Same rules as Staff → Kitchen and the monthly import (lib/menu-publish.ts).
 *
 * Body: { date, studentCategory | category ('ALL' or a category), selectedMealIds: string[], replace? }
 */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
      return NextResponse.json({ error: 'Unauthorized: Admin or Staff access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const { date, selectedMealIds, category, studentCategory, replace } = body || {};
    if (typeof date !== 'string' || !Array.isArray(selectedMealIds)) {
      return NextResponse.json({ error: 'Date and selectedMealIds array are required' }, { status: 400 });
    }
    const target = studentCategory || category;
    const cat = !target || target === 'ALL' ? 'ALL' : getStudentCategory(undefined, String(target));
    const mealIds = Array.from(new Set(selectedMealIds.filter((id: unknown) => typeof id === 'string' && id)));

    if (mealIds.length > 1) {
      return NextResponse.json(
        { error: 'Each class category has one dish per day. Select exactly one dish to publish.', code: 'ONE_DISH_PER_DAY' },
        { status: 400 }
      );
    }

    const result =
      mealIds.length === 1
        ? await publishDish({ date, studentCategory: cat, mealId: mealIds[0], replace, actorId: user.id })
        : await withdrawDish({ date, studentCategory: cat, actorId: user.id });
    if (result.status !== 200) return NextResponse.json(result.body, { status: result.status });

    try {
      const { recordMenuPublication } = await import('@/lib/menu-schedule');
      await recordMenuPublication(date, mealIds);
    } catch (e) {
      console.error('Failed to record menu publication:', e instanceof Error ? e.name : e);
    }

    return NextResponse.json({ ...result.body, publishedCount: mealIds.length });
  } catch (error) {
    console.error('Error publishing menu:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Failed to publish menu' }, { status: 500 });
  }
}
