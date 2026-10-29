import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getCurrentUser } from '@/lib/auth';
import { canAccessTeacherOrderRequest, isValidTeacherOrderId, readGuestToken } from '@/lib/teacher-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!isValidTeacherOrderId(id)) {
      return NextResponse.json({ error: 'Order ID is required' }, { status: 400 });
    }

    // Staff/admin session, or the guest cookie issued when this order was placed.
    const user = await getCurrentUser(req);
    if (!user && !readGuestToken(req, id)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const snap = await db.collection('teacher_orders').doc(id).get();
    const data = snap.data();
    // Same response for missing and not-owned orders, so IDs cannot be probed.
    if (!snap.exists || !data || !(await canAccessTeacherOrderRequest(user, data, id, req))) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    return NextResponse.json({ order: data });
  } catch (error) {
    console.error('Error fetching teacher order:', error);
    return NextResponse.json({ error: 'Failed to fetch order' }, { status: 500 });
  }
}
