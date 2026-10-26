import { NextResponse } from 'next/server';
import {
  getCashfreeRefund,
  getVerifiedCashfreePayment,
  paymentDetailsFromCashfree,
  verifyCashfreeWebhookSignature,
} from '@/lib/cashfree';
import { db } from '@/lib/firebase-admin';
import { fulfillParentOrder, fulfillTeacherOrder } from '@/lib/order-fulfillment';
import { applyRefundStatus } from '@/lib/order-cancellation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-webhook-signature') || '';
    const timestamp = req.headers.get('x-webhook-timestamp') || '';

    // Verify webhook signature: Must be present and cryptographically valid
    if (!signature || !timestamp) {
      console.warn('[Cashfree Webhook] Missing required x-webhook-signature or x-webhook-timestamp header');
      return NextResponse.json({ error: 'Missing required webhook signature headers' }, { status: 401 });
    }

    const isValid = verifyCashfreeWebhookSignature(rawBody, signature, timestamp);
    if (!isValid) {
      console.warn('[Cashfree Webhook] Invalid webhook signature detected');
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
    }

    let payload: any = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    const eventType = String(payload.type || payload.event || '');

    // Refund status updates: confirm the refund with the Cashfree API before recording it.
    if (eventType.startsWith('REFUND')) {
      const refundObj = payload.data?.refund || {};
      if (refundObj.order_id && refundObj.refund_id) {
        const refund = await getCashfreeRefund(String(refundObj.order_id), String(refundObj.refund_id));
        const status = await applyRefundStatus(String(refundObj.order_id), refund);
        console.log(`[Cashfree Webhook] Refund for order ${refundObj.order_id} is now ${status}`);
      }
      return NextResponse.json({ success: true, received: true });
    }

    const orderId = payload.data?.order?.order_id;
    if (!orderId) {
      return NextResponse.json({ received: true, message: 'No order_id present' });
    }

    const paymentObj = payload.data?.payment || {};
    if (eventType !== 'PAYMENT_SUCCESS_WEBHOOK' && paymentObj.payment_status !== 'SUCCESS') {
      // Payment failed or incomplete: Strictly DO NOT create any order!
      console.log(`[Cashfree Webhook] Non-success event (${eventType}) for order ${orderId}. Strictly no order created.`);
      return NextResponse.json({ success: true, received: true });
    }

    // The payload is only a hint: payment status, amount and currency come from the Cashfree API.
    const verified = await getVerifiedCashfreePayment(String(orderId));
    if (!verified.paid) {
      console.warn(`[Cashfree Webhook] Order ${orderId} is ${verified.orderStatus} on Cashfree; no order created.`);
      return NextResponse.json({ success: true, received: true });
    }
    const details = paymentDetailsFromCashfree(verified);

    const isTeacherId = orderId.startsWith('TCH-') || orderId.startsWith('TORD-');
    const pendingTeacherSnap = isTeacherId ? null : await db.collection('pending_teacher_orders').doc(orderId).get();

    // Fulfilment is idempotent, so repeated deliveries of the same event cannot create duplicate orders.
    const result = isTeacherId || pendingTeacherSnap?.exists
      ? await fulfillTeacherOrder(orderId, details)
      : await fulfillParentOrder(orderId, details);

    if (!result.success) {
      // Recorded for canteen review; acknowledge so the gateway does not keep retrying.
      console.error(`[Cashfree Webhook] Order ${orderId} needs review: ${result.reason} - ${result.message}`);
    } else if (!result.alreadyFulfilled) {
      console.log(`[Cashfree Webhook] Order ${orderId} confirmed via webhook.`);
    }

    return NextResponse.json({ success: true, received: true });
  } catch (error: any) {
    console.error('[Cashfree Webhook Error]:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
