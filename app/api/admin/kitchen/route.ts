import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getTodayString } from '@/lib/utils';
import { db } from '@/lib/firebase-admin';
import { applyServiceStatus, orderServiceDates, serviceStatusFor } from '@/lib/service-dates';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const kitchenCache = new Map<string, { data: any; timestamp: number }>();
const KITCHEN_CACHE_TTL = 10000;

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req);
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
        orderStatus: it.order ? serviceStatusFor(it.order, date) : 'CONFIRMED',
      };
    });

    const uniqueOrderIds = new Set(validItems.map((i) => i.orderId).filter(Boolean));
    const mealCountsList = Array.from(mealCountsMap.values())
      .map(({ orderIds, ...rest }) => rest)
      .sort((a, b) => b.count - a.count || b.orderCount - a.orderCount);

    // Paid teacher orders for the date, kept separate from the student counts above so existing
    // screens are unchanged, but the kitchen can see the full amount to prepare.
    const teacherSnap = await db.collection('teacher_orders').where('date', '==', date).get();
    const teacherMealsMap = new Map<string, { mealName: string; quantity: number }>();
    let teacherOrderCount = 0;
    for (const doc of teacherSnap.docs) {
      const order = doc.data();
      if (order.paymentStatus !== 'PAID' || order.orderStatus === 'CANCELLED') continue;
      teacherOrderCount += 1;
      for (const item of order.items || []) {
        const key = String(item.mealId || item.mealName || 'meal');
        const entry = teacherMealsMap.get(key) || { mealName: item.mealName || 'Meal', quantity: 0 };
        entry.quantity += Number(item.quantity) || 1;
        teacherMealsMap.set(key, entry);
      }
    }
    const teacherMeals = Array.from(teacherMealsMap.values()).sort((a, b) => b.quantity - a.quantity);

    const payload = {
      date,
      totalOrders: uniqueOrderIds.size,
      teacherOrderCount,
      teacherMealsTotal: teacherMeals.reduce((sum, m) => sum + m.quantity, 0),
      teacherMeals,
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
    const user = await getCurrentUser(req);
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

    let candidateIds: string[] = [];
    if (Array.isArray(orderIds) && orderIds.length > 0) {
      candidateIds = orderIds.filter((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id));
    } else if (date) {
      const items = await prisma.orderItem.findMany({
        where: { date },
        select: { orderId: true },
      });
      candidateIds = items.map((i) => i.orderId);
    }

    // Each order is re-read and updated in its own transaction, so a cancellation or refund that
    // lands at the same moment is never overwritten, and only paid, active orders move forward.
    // Only the given service date changes; without a date, multi-date orders are skipped.
    let affectedCount = 0;
    let skippedCount = 0;
    const now = new Date().toISOString();
    for (const id of Array.from(new Set(candidateIds))) {
      const updated = await db.runTransaction(async (transaction) => {
        const ref = db.collection('orders').doc(id);
        const snap = await transaction.get(ref);
        const ord = snap.data();
        if (!snap.exists || !ord) return false;
        const itemsSnap = await transaction.get(db.collection('orderItems').where('orderId', '==', id));
        const dates = orderServiceDates(itemsSnap.docs.map((d) => d.data()));
        if (ord.paymentStatus !== 'PAID' || ord.orderStatus === 'CANCELLED') return false;
        if (date ? !dates.includes(date) : dates.length !== 1) return false;
        const serviceDate = date || dates[0];
        if (serviceStatusFor(ord, serviceDate) === 'COLLECTED') return false;
        transaction.update(ref, { ...applyServiceStatus(ord, dates, serviceDate, status, user.id, now) });
        return true;
      });
      if (updated) affectedCount++;
      else skippedCount++;
    }
    if (affectedCount > 0) {
      try {
        const { notifyOrdersUpdated } = await import('@/lib/sync-events');
        await notifyOrdersUpdated();
      } catch {
        // non-blocking
      }
    }

    return NextResponse.json({
      success: true,
      message: `Updated ${affectedCount} orders to ${status}`,
      skipped: skippedCount,
    });
  } catch (error) {
    console.error('Error updating kitchen orders:', error);
    return NextResponse.json({ error: 'Failed to update kitchen orders' }, { status: 500 });
  }
}
