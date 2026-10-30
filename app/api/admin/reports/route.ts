import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const range = searchParams.get('range') || 'all'; // 7days, 30days, all

    // Fetch all active order items with meals and students
    const items = await prisma.orderItem.findMany({
      where: {
        order: { orderStatus: { not: 'CANCELLED' } },
      },
      include: {
        meal: true,
        student: true,
        order: {
          include: {
            parent: {
              include: { user: true },
            },
          },
        },
      },
      orderBy: { date: 'asc' },
    });

    // 1. Revenue and sales by date
    const dateMap = new Map<string, { date: string; revenue: number; mealsCount: number; ordersSet: Set<string> }>();
    // 2. Most ordered meals
    const mealMap = new Map<string, { mealId: string; mealName: string; count: number; revenue: number; category: string }>();
    // 3. Orders by class
    const classMap = new Map<string, number>();
    // 4. Orders by division
    const divisionMap = new Map<string, number>();

    let totalRevenue = 0;
    let totalMealsSold = 0;

    for (const it of items) {
      totalRevenue += it.totalPrice;
      totalMealsSold += it.quantity;

      // By date
      const d = it.date;
      if (!dateMap.has(d)) {
        dateMap.set(d, { date: d, revenue: 0, mealsCount: 0, ordersSet: new Set() });
      }
      const dEntry = dateMap.get(d)!;
      dEntry.revenue += it.totalPrice;
      dEntry.mealsCount += it.quantity;
      dEntry.ordersSet.add(it.orderId);

      // By meal
      if (!mealMap.has(it.mealId)) {
        mealMap.set(it.mealId, {
          mealId: it.mealId,
          mealName: it.meal.name,
          count: 0,
          revenue: 0,
          category: it.meal.category,
        });
      }
      const mEntry = mealMap.get(it.mealId)!;
      mEntry.count += it.quantity;
      mEntry.revenue += it.totalPrice;

      // By class
      const cls = `Class ${it.student.grade}`;
      classMap.set(cls, (classMap.get(cls) || 0) + it.quantity);

      // By division
      const div = `Division ${it.student.division}`;
      divisionMap.set(div, (divisionMap.get(div) || 0) + it.quantity);
    }

    const revenueByDate = Array.from(dateMap.values())
      .map((entry) => ({
        date: entry.date,
        revenue: entry.revenue,
        mealsCount: entry.mealsCount,
        ordersCount: entry.ordersSet.size,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const mostOrderedMeals = Array.from(mealMap.values()).sort((a, b) => b.count - a.count);

    const ordersByClass = Array.from(classMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const ordersByDivision = Array.from(divisionMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // CSV rows ready for one-click export
    const exportRows = items.map((it) => ({
      orderId: it.orderId,
      date: it.date,
      parentName: it.order.parent.user.name,
      parentPhone: it.order.parent.user.phone || '',
      studentName: it.student.name,
      studentId: it.student.studentId,
      classDivision: `${it.student.grade}-${it.student.division}`,
      rollNo: it.student.rollNo,
      mealName: it.meal.name,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      totalPrice: it.totalPrice,
      orderStatus: it.order.orderStatus,
    }));

    return NextResponse.json({
      summary: {
        totalRevenue,
        totalMealsSold,
        totalOrders: new Set(items.map((i) => i.orderId)).size,
        uniqueStudents: new Set(items.map((i) => i.studentId)).size,
      },
      revenueByDate,
      mostOrderedMeals,
      ordersByClass,
      ordersByDivision,
      exportRows,
    });
  } catch (error) {
    console.error('Error fetching admin reports:', error);
    return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 });
  }
}
