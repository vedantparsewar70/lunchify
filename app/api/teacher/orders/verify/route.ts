import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getCurrentUser } from '@/lib/auth';
import { getVerifiedCashfreePayment, paymentDetailsFromCashfree } from '@/lib/cashfree';
import { fulfillTeacherOrder } from '@/lib/order-fulfillment';
import { canAccessTeacherOrderRequest, isValidTeacherOrderId, readGuestToken } from '@/lib/teacher-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { orderId } = await req.json().catch(() => ({}));
    if (!isValidTeacherOrderId(orderId)) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
    }

    // Staff/admin session, or the guest cookie issued when this order was placed.
    const user = await getCurrentUser(req);
    if (!user && !readGuestToken(req, orderId)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Existing orders: report their actual state, never re-fulfil
    const orderRef = db.collection('teacher_orders').doc(orderId);
    const orderSnap = await orderRef.get();
    const pendingSnap = await db.collection('pending_teacher_orders').doc(orderId).get();
    const record = orderSnap.exists ? orderSnap.data() || {} : pendingSnap.exists ? pendingSnap.data() || {} : null;

    if (!record || !(await canAccessTeacherOrderRequest(user, record, orderId, req))) {
      return NextResponse.json({ error: 'Teacher order session not found' }, { status: 404 });
    }

    if (orderSnap.exists && record.paymentStatus !== 'PENDING') {
      return NextResponse.json({
        success: record.paymentStatus === 'PAID',
        verified: record.paymentStatus === 'PAID',
        state: record.paymentStatus === 'PAID' ? 'PAID' : 'CANCELLED',
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
        // Paid, but no order: reported truthfully (never as "not paid").
        return NextResponse.json({
          success: false,
          verified: true,
          state: 'EXCEPTION',
          orderId,
          reason: result.reason,
          message: 'Your payment was received but the order could not be confirmed automatically. The canteen will review it and contact you about a refund if needed.',
        });
      }

      const updatedData = (await orderRef.get()).data() || {};
      return NextResponse.json({
        success: true,
        verified: true,
        state: 'PAID',
        orderId,
        paymentStatus: 'PAID',
        orderStatus: updatedData.orderStatus || 'CONFIRMED',
        teacherName: updatedData.teacherName || record.teacherName,
        totalAmount: updatedData.totalAmount || record.totalAmount,
      });
    }

    // 4. No successful payment (yet): strictly no order. ACTIVE = payment window still open.
    const stillOpen = verified.orderStatus === 'ACTIVE';
    return NextResponse.json({
      success: false,
      verified: false,
      state: stillOpen ? 'PENDING' : 'NOT_PAID',
      orderId,
      paymentStatus: stillOpen ? 'PENDING' : 'FAILED',
      orderStatus: 'NONE',
      message: stillOpen
        ? 'We have not received confirmation of this payment yet. If you completed it, please wait a minute. Do not pay again.'
        : 'This payment was not completed, so no order was created. If money was debited, your bank will reverse it automatically.',
    });
  } catch (error: any) {
    console.error('Error verifying teacher order:', error);
    return NextResponse.json({ error: 'Failed to verify order' }, { status: 500 });
  }
}
