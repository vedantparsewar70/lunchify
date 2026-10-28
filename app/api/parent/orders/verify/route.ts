import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/firebase-admin';
import { getVerifiedCashfreePayment, paymentDetailsFromCashfree } from '@/lib/cashfree';
import { fulfillParentOrder } from '@/lib/order-fulfillment';
import { refundPaymentException } from '@/lib/payment-exceptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { orderId } = await req.json().catch(() => ({}));
    if (!orderId || typeof orderId !== 'string') {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
    }

    const orderSnap = await db.collection('orders').doc(orderId).get();
    const pendingSnap = await db.collection('pending_orders').doc(orderId).get();
    const record = orderSnap.exists ? orderSnap.data() || {} : pendingSnap.exists ? pendingSnap.data() || {} : null;

    // Parents may only verify their own checkouts; missing and not-owned look the same.
    if (!record || (user.role === 'PARENT' && record.parentId !== user.parentId)) {
      return NextResponse.json({ error: 'Checkout session or order not found' }, { status: 404 });
    }

    // 1. Existing orders: report their actual state, never re-fulfil (e.g. a cancelled order)
    if (orderSnap.exists && record.paymentStatus !== 'PENDING') {
      return NextResponse.json({
        success: record.paymentStatus === 'PAID',
        verified: record.paymentStatus === 'PAID',
        orderId,
        paymentStatus: record.paymentStatus,
        orderStatus: record.orderStatus || 'CONFIRMED',
      });
    }

    // 2. Query Cashfree API to verify authoritative payment status
    let verified;
    try {
      verified = await getVerifiedCashfreePayment(orderId);
    } catch (cfErr: any) {
      console.warn('[Cashfree Verify] Could not retrieve Cashfree order status:', cfErr.message);
      return NextResponse.json(
        { error: 'Could not confirm payment status right now. Please refresh in a moment.' },
        { status: 503 }
      );
    }

    // 3. ONLY create order if payment is successfully completed.
    // fulfillParentOrder checks the paid amount and currency against the pending order total.
    if (verified.paid) {
      const details = paymentDetailsFromCashfree(verified);
      const result = await fulfillParentOrder(orderId, details);

      if (!result.success) {
        console.error(`[Payment Review] Order ${orderId}: ${result.reason} - ${result.message}`);
        let error = 'Payment received but the order could not be confirmed automatically. The canteen will review it.';
        if (result.reason === 'STOCK_UNAVAILABLE' && result.exceptionRecorded) {
          const refund = await refundPaymentException(orderId);
          error =
            refund.refundState === 'REFUNDED'
              ? `A meal in your order sold out before payment completed, so no order was created. ₹${refund.refundAmount} has been refunded to your original payment method.`
              : refund.refundState === 'REFUND_PENDING'
              ? `A meal in your order sold out before payment completed, so no order was created. A full refund of ₹${refund.refundAmount} has been initiated to your original payment method.`
              : 'A meal in your order sold out before payment completed, so no order was created. The canteen will arrange your refund; please contact the school canteen if you have questions.';
        }
        return NextResponse.json({ error, reason: result.reason }, { status: 409 });
      }

      return NextResponse.json({
        success: true,
        verified: true,
        orderId: result.orderId,
        paymentStatus: 'PAID',
        orderStatus: 'CONFIRMED',
        transactionRef: details.transactionRef,
      });
    }

    // 4. Payment is incomplete, dropped, or failed: Strictly DO NOT create any order!
    return NextResponse.json({
      success: false,
      verified: false,
      orderId,
      paymentStatus: 'FAILED',
      orderStatus: 'NONE',
      cashfreeStatus: verified.orderStatus,
      message: 'Payment was not completed. Strictly no order was created.',
    });
  } catch (error: any) {
    console.error('Error verifying order payment:', error);
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
