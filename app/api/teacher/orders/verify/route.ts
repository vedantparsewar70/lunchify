import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getCurrentUser } from '@/lib/auth';
import { getVerifiedCashfreePayment, paymentDetailsFromCashfree } from '@/lib/cashfree';
import { fulfillTeacherOrder } from '@/lib/order-fulfillment';
import { canAccessTeacherOrder } from '@/lib/teacher-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { orderId } = await req.json().catch(() => ({}));
    if (!orderId || typeof orderId !== 'string') {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
    }

    // 1. Existing orders: report their actual state, never re-fulfil
    const orderRef = db.collection('teacher_orders').doc(orderId);
    const orderSnap = await orderRef.get();
    const pendingSnap = await db.collection('pending_teacher_orders').doc(orderId).get();
    const record = orderSnap.exists ? orderSnap.data() || {} : pendingSnap.exists ? pendingSnap.data() || {} : null;

    if (!record || !canAccessTeacherOrder(user, record)) {
      return NextResponse.json({ error: 'Teacher order session not found' }, { status: 404 });
    }

    if (orderSnap.exists && record.paymentStatus !== 'PENDING') {
      return NextResponse.json({
        success: record.paymentStatus === 'PAID',
        verified: record.paymentStatus === 'PAID',
        orderId,
        paymentStatus: record.paymentStatus,
        orderStatus: record.orderStatus || 'CONFIRMED',
        teacherName: record.teacherName,
        totalAmount: record.totalAmount,
      });
    }

    // 2. Query Cashfree API to verify authoritative payment status
    let verified;
    try {
      verified = await getVerifiedCashfreePayment(orderId);
    } catch (cfErr: any) {
      console.warn('[Teacher Cashfree Verify] Error fetching Cashfree status:', cfErr.message);
      return NextResponse.json(
        { error: 'Could not confirm payment status right now. Please refresh in a moment.' },
        { status: 503 }
      );
    }

    // 3. ONLY create order if payment is successfully completed
    if (verified.paid) {
      const result = await fulfillTeacherOrder(orderId, paymentDetailsFromCashfree(verified));

      if (!result.success) {
        console.error(`[Teacher Payment Review] Order ${orderId}: ${result.reason} - ${result.message}`);
        return NextResponse.json(
          { error: 'Payment received but the order could not be confirmed automatically. The canteen will review it.' },
          { status: 409 }
        );
      }

      const updatedData = (await orderRef.get()).data() || {};
      return NextResponse.json({
        success: true,
        verified: true,
        orderId,
        paymentStatus: 'PAID',
        orderStatus: updatedData.orderStatus || 'CONFIRMED',
        teacherName: updatedData.teacherName || record.teacherName,
        totalAmount: updatedData.totalAmount || record.totalAmount,
      });
    }

    // 4. Payment is incomplete, dropped, or failed: Strictly DO NOT create any order!
    return NextResponse.json({
      success: false,
      verified: false,
      orderId,
      paymentStatus: 'FAILED',
      orderStatus: 'NONE',
      message: 'Payment was not completed. Strictly no order was created.',
    });
  } catch (error: any) {
    console.error('Error verifying teacher order:', error);
    return NextResponse.json({ error: 'Failed to verify order' }, { status: 500 });
  }
}
