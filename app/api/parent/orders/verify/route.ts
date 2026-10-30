import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/firebase-admin';
import { getCashfreeOrderPayments, getVerifiedCashfreePayment, paymentDetailsFromCashfree } from '@/lib/cashfree';
import { fulfillParentOrder } from '@/lib/order-fulfillment';
import { isAutoRefundReason, parentIssueState, PAYMENT_EXCEPTIONS, refundPaymentException } from '@/lib/payment-exceptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function exceptionMessage(reason: string | undefined, refundState: string | null, amount: number): string {
  const why =
    reason === 'STOCK_UNAVAILABLE'
      ? 'A meal in your order sold out before your payment completed, so no order was created.'
      : reason === 'PAID_AFTER_CUTOFF'
      ? 'Your payment was received after the ordering deadline, so the order was not confirmed automatically.'
      : reason === 'SERVICE_UNAVAILABLE'
      ? 'Your payment was received, but the meal is no longer being served that day, so the order was not confirmed automatically.'
      : 'Your payment was received but the order could not be confirmed automatically.';
  const rupees = `₹${amount}`;
  if (refundState === 'REFUNDED') return `${why} ${rupees} has been refunded to your original payment method.`;
  if (refundState === 'REFUND_PENDING' || refundState === 'NOT_REQUESTED') {
    return `${why} A full refund of ${rupees} has been started to your original payment method.`;
  }
  if (refundState === 'REFUND_FAILED') return `${why} The refund could not be completed automatically. Please contact the school canteen.`;
  return `${why} The canteen will review it and either accept your order or refund ${rupees} in full. Please do not pay again.`;
}

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

    const orderSnap = await db.collection('orders').doc(orderId).get();
    const pendingSnap = await db.collection('pending_orders').doc(orderId).get();
    const record = orderSnap.exists ? orderSnap.data() || {} : pendingSnap.exists ? pendingSnap.data() || {} : null;

    // Parents may only verify their own checkouts; missing and not-owned look the same.
    // Other roles (e.g. teachers) never see parent checkouts; staff and admins may check any.
    const isOwner = user.role === 'PARENT' && record?.parentId === user.parentId;
    if (!record || !(isOwner || user.role === 'STAFF' || user.role === 'ADMIN')) {
      return NextResponse.json({ error: 'Checkout session or order not found' }, { status: 404 });
    }

    // 1. Existing orders: report their actual state, never re-fulfil (e.g. a cancelled order)
    if (orderSnap.exists && record.paymentStatus !== 'PENDING') {
      return NextResponse.json({
        success: record.paymentStatus === 'PAID',
        verified: record.paymentStatus === 'PAID',
        state: record.paymentStatus === 'PAID' ? 'PAID' : 'CANCELLED',
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
        if (isAutoRefundReason(result.reason) && result.exceptionRecorded) {
          await refundPaymentException(orderId);
        }
        // Report the exception as it now stands (under review, refund started, refunded, ...).
        const exceptionSnap = await db.collection(PAYMENT_EXCEPTIONS).doc(orderId).get();
        const exception = exceptionSnap.data() || {};
        const refundState: string | null = exception.refundState || null;
        const refundAmount = Number(exception.paidAmount) || 0;
        // A captured payment that could not become an order: reported truthfully, never as "not paid".
        return NextResponse.json({
          success: false,
          verified: true,
          state: 'EXCEPTION',
          orderId,
          reason: result.reason,
          refundState,
          issueState: parentIssueState(refundState),
          message: exceptionMessage(result.reason, refundState, refundAmount),
        });
      }

      return NextResponse.json({
        success: true,
        verified: true,
        state: 'PAID',
        orderId: result.orderId,
        paymentStatus: 'PAID',
        orderStatus: 'CONFIRMED',
        transactionRef: details.transactionRef,
      });
    }

    // 4. No successful payment (yet): strictly no order is created. ACTIVE means the payment
    // window is still open (a UPI/bank payment may still complete); anything else is closed.
    const stillOpen = verified.orderStatus === 'ACTIVE';

    // A failed or abandoned attempt leaves the Cashfree order ACTIVE. If the latest attempt ended
    // and none is still in progress, the parent may try again: the cart reopens this same Cashfree
    // order, which can only be paid once, so a retry can never charge twice.
    if (stillOpen) {
      const attempts = await getCashfreeOrderPayments(orderId).catch(() => []);
      const inProgress = attempts.some((p) => ['PENDING', 'NOT_ATTEMPTED', 'FLAGGED', 'SUCCESS'].includes(String(p?.payment_status)));
      if (attempts.length > 0 && !inProgress) {
        return NextResponse.json({
          success: false,
          verified: false,
          state: 'NOT_PAID',
          retryable: true,
          orderId,
          paymentStatus: 'FAILED',
          orderStatus: 'NONE',
          cashfreeStatus: verified.orderStatus,
          message: 'Your payment attempt did not go through, so no order was created. You can go back to the cart and try again; you will not be charged twice for this order.',
        });
      }
    }

    return NextResponse.json({
      success: false,
      verified: false,
      state: stillOpen ? 'PENDING' : 'NOT_PAID',
      orderId,
      paymentStatus: stillOpen ? 'PENDING' : 'FAILED',
      orderStatus: 'NONE',
      cashfreeStatus: verified.orderStatus,
      message: stillOpen
        ? 'We have not received confirmation of this payment yet. If you completed it, please wait a minute. Do not pay again.'
        : 'This payment was not completed, so no order was created. If money was debited, your bank will reverse it automatically.',
    });
  } catch (error: any) {
    console.error('Error verifying order payment:', error);
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
