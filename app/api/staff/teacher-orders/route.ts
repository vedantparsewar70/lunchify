import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getCurrentUser } from '@/lib/auth';
import { getTodayString } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date') || getTodayString();
    const search = searchParams.get('search')?.toLowerCase().trim();

    let query = db.collection('teacher_orders').where('date', '==', date);
    const snap = await query.get();

    let orders = snap.docs.map((d) => d.data());

    // Strictly filter for completed PAID orders only
    orders = orders.filter((o: any) => o.paymentStatus === 'PAID');

    // Sort by latest created
    orders.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (search) {
      orders = orders.filter((o: any) => {
        const matchName = (o.teacherName || '').toLowerCase().includes(search);
        const matchId = (o.id || '').toLowerCase().includes(search);
        const matchItems = (o.items || []).some((it: any) =>
          (it.mealName || '').toLowerCase().includes(search)
        );
        return matchName || matchId || matchItems;
      });
    }

    return NextResponse.json({ orders });
  } catch (error) {
    console.error('Error fetching teacher orders for staff:', error);
    return NextResponse.json({ error: 'Failed to fetch teacher orders' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { orderId, orderStatus = 'GIVEN' } = body;

    if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(orderId)) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
    }
    // GIVEN = handed over; CONFIRMED = undo a mistaken handover. Nothing else is accepted here
    // (cancellation and refunds are not done through this endpoint).
    if (orderStatus !== 'GIVEN' && orderStatus !== 'CONFIRMED') {
      return NextResponse.json({ error: 'Invalid order status' }, { status: 400 });
    }

    const ref = db.collection('teacher_orders').doc(orderId);
    const outcome = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists) return { status: 404, error: 'Order not found' };
      const orderData = snap.data() || {};
      if (orderData.paymentStatus !== 'PAID') {
        return { status: 400, error: 'Cannot change an unpaid teacher order.' };
      }
      const now = new Date().toISOString();
      if (orderStatus === 'GIVEN') {
        if (orderData.orderStatus === 'GIVEN' || orderData.orderStatus === 'COLLECTED') {
          return { status: 409, error: 'This order has already been given.' };
        }
        transaction.update(ref, { orderStatus: 'GIVEN', collectedAt: now, updatedAt: now });
      } else {
        // Undo keeps the original collectedAt as an audit trail.
        transaction.update(ref, { orderStatus: 'CONFIRMED', updatedAt: now, revertedAt: now, revertedBy: user.id });
      }
      return null;
    });
    if (outcome) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    try {
      const { notifyTeacherOrdersUpdated, notifyOrdersUpdated } = await import('@/lib/sync-events');
      await Promise.all([notifyTeacherOrdersUpdated(), notifyOrdersUpdated()]);
    } catch {
      // non-blocking
    }

    return NextResponse.json({ success: true, orderId, orderStatus });
  } catch (error) {
    console.error('Error updating teacher order status:', error);
    return NextResponse.json({ error: 'Failed to update order status' }, { status: 500 });
  }
}
