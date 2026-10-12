import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getTodayString } from '@/lib/utils';
import { db } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const kitchenCache = new Map<string, { data: any; timestamp: number }>();
const KITCHEN_CACHE_TTL = 10000;

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
      return NextResponse.json({ error: 'Unauthorized: Admin or Staff access required' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date') || getTodayString();
    const bypassCache = searchParams.get('bypassCache') === 'true' || searchParams.get('refresh') === 'true';

    const cached = kitchenCache.get(date);
    if (!bypassCache && cached && Date.now() - cached.timestamp < KITCHEN_CACHE_TTL) {
      return NextResponse.json(cached.data, {
        headers: { 'X-Cache': 'HIT', 'Cache-Control': 'no-store, max-age=0' },
      });
    }

    // Fetch all active order items for this date
    const items = await prisma.orderItem.findMany({
      where: {
        date,
      },
      include: {
        meal: true,
        student: {
          include: {
            studentAllergies: {
              include: { allergy: true },
            },
          },
        },
        order: true,
      },
      orderBy: [
        { student: { grade: 'asc' } },
        { student: { division: 'asc' } },
        { student: { rollNo: 'asc' } },
      ],
    });

    // Strictly filter out CANCELLED orders or FAILED/REFUNDED/CANCELLED payments
    const validItems = items.filter((it) => {
      const order = it.order;
      if (!order) return false;
      if (order.orderStatus === 'CANCELLED') return false;
      // Strictly require successful PAID payment
      if (order.paymentStatus !== 'PAID') {
        return false;
      }
      return true;
    });

    // Aggregate meal counts for kitchen production
    const mealCountsMap = new Map<
      string,
      {
        mealId: string;
        mealName: string;
        category: string;
        count: number;
        quantityToPrepare: number;
        orderCount: number;
        isVegetarian: boolean;
        orderIds: Set<string>;
      }
    >();
    let totalMeals = 0;
    let allergyAlertsCount = 0;

    for (const it of validItems) {
      totalMeals += it.quantity;
      if (it.hasAllergyAlert) {
        allergyAlertsCount += it.quantity;
      }

      const existing = mealCountsMap.get(it.mealId);
      if (existing) {
        existing.count += it.quantity;
        existing.quantityToPrepare = existing.count;
        if (it.orderId) existing.orderIds.add(it.orderId);
        existing.orderCount = existing.orderIds.size;
      } else {
        const orderIds = new Set<string>();
        if (it.orderId) orderIds.add(it.orderId);
        mealCountsMap.set(it.mealId, {
          mealId: it.mealId,
          mealName: it.meal.name,
          category: it.meal.category,
          count: it.quantity,
          quantityToPrepare: it.quantity,
          orderCount: orderIds.size || 1,
          isVegetarian: it.meal.isVegetarian,
          orderIds,
        });
      }
    }

    // Breakdown by Class/Division & Student Category
    const classBreakdownMap = new Map<string, number>();
    const studentCategoryBreakdown: Record<string, number> = {
      'Pre-primary': 0,
      'Primary': 0,
      'Secondary': 0,
    };

    for (const it of validItems) {
      const key = `Class ${it.student.grade}-${it.student.division}`;
      classBreakdownMap.set(key, (classBreakdownMap.get(key) || 0) + it.quantity);

      const cat =
        (it.student as any).studentCategory ||
        (it.student.grade?.toLowerCase().includes('nursery') ||
        it.student.grade?.toLowerCase().includes('kg')
          ? 'Pre-primary'
          : parseInt(it.student.grade, 10) <= 5
          ? 'Primary'
          : 'Secondary');
      studentCategoryBreakdown[cat] = (studentCategoryBreakdown[cat] || 0) + it.quantity;
    }

    const studentList = validItems.map((it) => {
      const studentAllergies = it.student.studentAllergies ? it.student.studentAllergies.map((sa: any) => sa.allergy?.name) : [];
      if (it.student.allergies && studentAllergies.length === 0) {
        it.student.allergies.split(/[,;]/).forEach((p: string) => {
          const t = p.trim();
          if (t && !studentAllergies.includes(t)) studentAllergies.push(t);
        });
      }

      const studentCat =
        (it.student as any).studentCategory ||
        (it.student.grade?.toLowerCase().includes('nursery') ||
        it.student.grade?.toLowerCase().includes('kg')
          ? 'Pre-primary'
          : parseInt(it.student.grade, 10) <= 5
          ? 'Primary'
          : 'Secondary');

      return {
        orderItemId: it.id,
        orderId: it.orderId,
        studentName: it.student.name,
        studentId: it.student.studentId,
        studentCategory: studentCat,
        grade: it.student.grade,
        division: it.student.division,
        rollNo: it.student.rollNo,
        allergies: studentAllergies.join(', ') || it.student.allergies || null,
        hasAllergyAlert: it.hasAllergyAlert,
        conflictAllergens: it.conflictAllergens || it.student.allergies || null,
        mealName: it.meal.name,
        category: it.meal.category,
        isVegetarian: it.meal.isVegetarian,
        quantity: it.quantity,
        orderStatus: it.order?.orderStatus || 'CONFIRMED',
      };
    });

    const uniqueOrderIds = new Set(validItems.map((i) => i.orderId).filter(Boolean));
    const mealCountsList = Array.from(mealCountsMap.values())
      .map(({ orderIds, ...rest }) => rest)
      .sort((a, b) => b.count - a.count || b.orderCount - a.orderCount);

    const payload = {
      date,
      totalOrders: uniqueOrderIds.size,
      totalMeals,
      allergyAlertsCount,
      mealCounts: mealCountsList,
      classBreakdown: Array.from(classBreakdownMap.entries()).map(([cls, count]) => ({
        classDivision: cls,
        count,
      })),
      studentCategoryBreakdown,
      studentList,
    };

    kitchenCache.set(date, { data: payload, timestamp: Date.now() });

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('Error fetching kitchen data:', error);
    return NextResponse.json({ error: 'Failed to fetch kitchen data' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    kitchenCache.clear();
    const user = await getCurrentUser();
    if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
      return NextResponse.json({ error: 'Unauthorized: Admin or Staff access required' }, { status: 403 });
    }

    const body = await req.json();
    const { date, status, orderIds }: { date?: string; status: 'PREPARING' | 'READY' | 'COLLECTED'; orderIds?: string[] } = body;

    if (!status) {
      return NextResponse.json({ error: 'Status is required' }, { status: 400 });
    }

    const validStatuses = ['PREPARING', 'READY', 'COLLECTED'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid kitchen status' }, { status: 400 });
    }

    let affectedCount = 0;

    if (orderIds && orderIds.length > 0) {
      // Fetch these orders to filter out CANCELLED and already COLLECTED orders
      const orderDocs = await Promise.all(orderIds.map((id) => db.collection('orders').doc(id).get()));
      const validIds: string[] = [];

      for (const d of orderDocs) {
        if (!d.exists) continue;
        const ord = d.data();
        if (!ord) continue;
        // Never override terminal orders
        if (ord.orderStatus === 'CANCELLED' || ord.orderStatus === 'COLLECTED') continue;
        validIds.push(d.id);
      }

      if (validIds.length > 0) {
        const res = await prisma.order.updateMany({
          where: { id: { in: validIds } },
          data: { orderStatus: status },
        });
        affectedCount = res.count;
      }
    } else if (date) {
      const items = await prisma.orderItem.findMany({
        where: {
          date,
          order: { orderStatus: { not: 'CANCELLED' } },
        },
        select: { orderId: true },
      });

      const uniqueOrderIds = Array.from(new Set(items.map((i) => i.orderId)));
      const orderDocs = await Promise.all(uniqueOrderIds.map((id) => db.collection('orders').doc(id).get()));
      const validIds = orderDocs
        .filter((d) => d.exists && d.data()?.orderStatus !== 'CANCELLED' && d.data()?.orderStatus !== 'COLLECTED')
        .map((d) => d.id);

      if (validIds.length > 0) {
        const res = await prisma.order.updateMany({
          where: { id: { in: validIds } },
          data: { orderStatus: status },
        });
        affectedCount = res.count;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Updated ${affectedCount} orders to ${status}`,
    });
  } catch (error) {
    console.error('Error updating kitchen orders:', error);
    return NextResponse.json({ error: 'Failed to update kitchen orders' }, { status: 500 });
  }
}
