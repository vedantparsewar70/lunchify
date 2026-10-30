import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getTodayString, getOffsetDateString, APP_TIMEZONE } from '@/lib/utils';

let cachedStats: { data: any; timestamp: number } | null = null;
const CACHE_TTL_MS = 15000;

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
      return NextResponse.json({ error: 'Unauthorized: Admin or Staff access required' }, { status: 403 });
    }

    if (cachedStats && Date.now() - cachedStats.timestamp < CACHE_TTL_MS) {
      return NextResponse.json(cachedStats.data, {
        headers: { 'X-Cache': 'HIT' },
      });
    }

    const todayStr = getTodayString(APP_TIMEZONE);
    const tomorrowStr = getOffsetDateString(1, APP_TIMEZONE);

    // Run all dashboard queries in parallel with Promise.all for sub-second responses
    const [tomorrowMenus, tomorrowItems, todayItems, allActiveOrders, recentOrders] = await Promise.all([
      // 1. Tomorrow's menu
      prisma.menu.findMany({
        where: {
          date: tomorrowStr,
          isActive: true,
        },
        include: { meal: true },
      }),

      // 2. Tomorrow's active items
      prisma.orderItem.findMany({
        where: {
          date: tomorrowStr,
          order: {
            orderStatus: { not: 'CANCELLED' },
          },
        },
        include: { meal: true },
      }),

      // 3. Today's active items
      prisma.orderItem.findMany({
        where: {
          date: todayStr,
          order: {
            orderStatus: { not: 'CANCELLED' },
          },
        },
        include: { meal: true },
      }),

      // 4. All active orders for totals
      prisma.order.findMany({
        where: {
          orderStatus: { not: 'CANCELLED' },
        },
      }),

      // 5. Recent 5 orders
      prisma.order.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          parent: {
            include: { user: true },
          },
          items: {
            include: {
              student: true,
              meal: true,
            },
          },
        },
      }),
    ]);

    const isTomorrowMenuPublished = tomorrowMenus.length > 0;
    const tomorrowPublishedCount = tomorrowMenus.length;

    const tomorrowMealCountsMap = new Map<string, { mealName: string; count: number; category: string; isVegetarian: boolean }>();
    for (const it of tomorrowItems) {
      const existing = tomorrowMealCountsMap.get(it.mealId);
      if (existing) {
        existing.count += it.quantity;
      } else {
        tomorrowMealCountsMap.set(it.mealId, {
          mealName: it.meal?.name || 'Meal',
          count: it.quantity,
          category: it.meal?.category || 'General',
          isVegetarian: Boolean(it.meal?.isVegetarian),
        });
      }
    }
    const tomorrowProduction = Array.from(tomorrowMealCountsMap.values()).sort((a, b) => b.count - a.count);
    const tomorrowTotalMeals = tomorrowItems.reduce((sum: number, it: any) => sum + it.quantity, 0);

    const todayTotalMeals = todayItems.reduce((sum: number, it: any) => sum + it.quantity, 0);

    const totalOrders = allActiveOrders.length;
    const totalOrderValue = allActiveOrders.reduce((sum: number, o: any) => sum + (o.totalAmount || 0), 0);
    const totalItems = tomorrowTotalMeals + todayTotalMeals;
    const studentsOrdered = new Set([...tomorrowItems, ...todayItems].map((it: any) => it.studentId)).size;

    const formattedRecentOrders = recentOrders.map((o: any) => ({
      id: o.id,
      parentName: o.parent?.user?.name || 'Parent',
      totalAmount: o.totalAmount,
      orderStatus: o.orderStatus,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt.toISOString(),
      items: (o.items || []).map((it: any) => ({
        mealName: it.meal?.name || 'Meal',
        studentName: it.student?.name || 'Student',
        grade: it.student?.grade || '',
        division: it.student?.division || '',
        date: it.date,
        quantity: it.quantity,
      })),
    }));

    const responsePayload = {
      stats: {
        totalOrders,
        studentsOrdered,
        totalItems,
        totalOrderValue,
        todayTotalMeals,
        tomorrowTotalMeals,
        nextMealDate: tomorrowStr,
        isTomorrowMenuPublished,
        tomorrowPublishedCount,
      },
      tomorrowProduction,
      recentOrders: formattedRecentOrders,
    };

    cachedStats = {
      data: responsePayload,
      timestamp: Date.now(),
    };

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    return NextResponse.json({ error: 'Failed to fetch admin stats' }, { status: 500 });
  }
}
