import crypto from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { db } from './firebase-admin';
import {
  CashfreeRefund,
  createCashfreeRefund,
  getCashfreeRefund,
  isMockPaymentAllowed,
} from './cashfree';
import { collectMenuStockInTransaction } from './menu-stock';

export type RefundPaymentStatus = 'REFUNDED' | 'REFUND_PENDING' | 'REFUND_FAILED';

export interface RefundClient {
  create(params: { orderId: string; refundId: string; amount: number; note?: string }): Promise<CashfreeRefund>;
  get(orderId: string, refundId: string): Promise<CashfreeRefund>;
}

export const cashfreeRefunds: RefundClient = {
  create: createCashfreeRefund,
  get: getCashfreeRefund,
};

export class OrderCancellationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'OrderCancellationError';
    this.status = status;
  }
}

export interface CancelOrderOptions {
  orderId: string;
  /** When set, the order must belong to this parent. */
  parentId?: string;
  cancelledBy: string;
  /** Order statuses that may not be cancelled. */
  blockedStatuses?: string[];
}

export interface CancelOrderResult {
  orderId: string;
  alreadyCancelled: boolean;
  paymentStatus: string;
  refundAmount: number;
  message: string;
}

/** Stable per order, so a repeated refund request can never create a second refund. */
export function refundIdForOrder(orderId: string): string {
  // Cashfree documents refund_id as alphanumeric (3-40 chars), so no separators.
  return `RF${crypto.createHash('sha256').update(orderId).digest('hex').slice(0, 24)}`;
}

/**
 * Only SUCCESS is a completed refund; CANCELLED and REJECTED are definite failures; anything
 * else (PENDING, PENDING_APPROVAL, ONHOLD, unknown) is still in progress.
 */
export function paymentStatusForRefund(refundStatus: string): RefundPaymentStatus {
  const status = String(refundStatus).toUpperCase();
  if (status === 'SUCCESS') return 'REFUNDED';
  if (status === 'CANCELLED' || status === 'REJECTED') return 'REFUND_FAILED';
  return 'REFUND_PENDING';
}

function refundMessage(paymentStatus: string, amount: number): string {
  if (paymentStatus === 'REFUNDED') {
    return `Order cancelled and ₹${amount} refunded to your original payment method.`;
  }
  if (paymentStatus === 'REFUND_PENDING') {
    return `Order cancelled. A refund of ₹${amount} has been initiated and will reach your original payment method once the payment gateway completes it.`;
  }
  if (paymentStatus === 'REFUND_FAILED') {
    return `Order cancelled, but the refund of ₹${amount} could not be processed automatically. Please contact the school canteen.`;
  }
  return 'Order cancelled.';
}

/**
 * Requests a refund once (same refund_id on every call) and reads back the existing refund
 * when the gateway rejects a duplicate. Never reports REFUNDED unless the gateway says SUCCESS.
 */
export async function requestRefund(
  order: Record<string, any>,
  orderId: string,
  refundId: string,
  amount: number,
  refunds: RefundClient
): Promise<{ paymentStatus: RefundPaymentStatus; refundStatus: string; cfRefundId: string | null; error: string | null }> {
  if (!order.cashfreeOrderId && isMockPaymentAllowed()) {
    return { paymentStatus: 'REFUNDED', refundStatus: 'MOCK_SUCCESS', cfRefundId: null, error: null };
  }

  const fromRefund = (refund: CashfreeRefund) => ({
    paymentStatus: paymentStatusForRefund(refund.status),
    refundStatus: refund.status,
    cfRefundId: refund.cfRefundId,
    error: null,
  });
  // We cannot tell whether a refund exists (timeout, network error, 429/5xx, or a lookup rejected
  // with 400/401/403). Never call it failed or done, and never create on that basis: the next
  // attempt looks it up again first.
  const unresolved = (err: any) => {
    const error = String(err?.message || 'Refund state unknown').slice(0, 200);
    const refundStatus = err?.ambiguous ? 'UNKNOWN' : 'LOOKUP_FAILED';
    console.error(`[Refund] Refund state unresolved (${refundStatus}) for order ${orderId}: ${error}`);
    return { paymentStatus: 'REFUND_PENDING' as const, refundStatus, cfRefundId: null, error };
  };
  const isNotFound = (err: any) => err?.status === 404;

  // 1. Look up first. Only Cashfree's documented 404 "Resource Not found" proves no refund
  //    with this ID exists, so only then is a create attempted.
  try {
    return fromRefund(await refunds.get(orderId, refundId));
  } catch (lookupErr: any) {
    if (!isNotFound(lookupErr)) return unresolved(lookupErr);
  }

  // 2. Create. The idempotency key makes a retried create replay instead of refunding twice.
  try {
    return fromRefund(await refunds.create({ orderId, refundId, amount }));
  } catch (createErr: any) {
    // Timeout/network/429/5xx: it may have been created. Resolve on the next attempt's lookup.
    if (createErr?.ambiguous) return unresolved(createErr);
    // Rejected (e.g. 409 because a concurrent attempt created it, or 400/401/422): check again.
    try {
      return fromRefund(await refunds.get(orderId, refundId));
    } catch (recheckErr: any) {
      if (!isNotFound(recheckErr)) return unresolved(recheckErr);
    }
    // Rejected and confirmed absent: this request definitely did not create a refund.
    const error = String(createErr?.message || 'Refund request failed').slice(0, 200);
    console.error(`[Refund] Refund request rejected for order ${orderId}: ${error}`);
    return { paymentStatus: 'REFUND_FAILED', refundStatus: 'ERROR', cfRefundId: null, error };
  }
}

/**
 * Cancels a parent order, restores its menu stock once, and refunds paid orders through Cashfree.
 * The order is only marked REFUNDED when the gateway reports the refund as successful.
 * Calling it again for an order whose refund is pending or failed retries the same refund
 * (same refund_id) without restoring stock again.
 */
export async function cancelOrderWithRefund(
  options: CancelOrderOptions,
  firestore: Firestore = db,
  refunds: RefundClient = cashfreeRefunds
): Promise<CancelOrderResult> {
  const { orderId } = options;
  const blockedStatuses = options.blockedStatuses ?? ['READY', 'COLLECTED'];
  const orderRef = firestore.collection('orders').doc(orderId);
  const now = new Date().toISOString();

  const phase = await firestore.runTransaction(async (transaction) => {
    // --- Reads ---
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) {
      throw new OrderCancellationError('Order not found', 404);
    }
    const order = orderSnap.data() || {};
    if (options.parentId && order.parentId !== options.parentId) {
      throw new OrderCancellationError('Order not found', 404);
    }

    const refundAmount = Number(order.totalAmount || 0);
    const refundId: string = order.refundId || refundIdForOrder(orderId);

    if (order.orderStatus === 'CANCELLED') {
      const retryRefund = order.paymentStatus === 'REFUND_PENDING' || order.paymentStatus === 'REFUND_FAILED';
      return { order, refundId, refundAmount, refundNeeded: retryRefund, alreadyCancelled: true, paymentStatus: String(order.paymentStatus) };
    }

    if (blockedStatuses.includes(order.orderStatus)) {
      throw new OrderCancellationError('Cannot cancel order that has already been prepared or collected');
    }

    const itemsSnap = await transaction.get(firestore.collection('orderItems').where('orderId', '==', orderId));
    const menuStock = await collectMenuStockInTransaction(
      transaction,
      firestore,
      itemsSnap.docs.map((d) => {
        const item = d.data();
        return {
          mealId: item.mealId,
          date: item.date,
          quantity: Number(item.quantity || 0),
          studentCategory: item.studentCategory || null,
          menuId: item.menuId || null,
        };
      })
    );

    // --- Writes ---
    for (const s of menuStock.stock) {
      transaction.update(s.ref, { availableQuantity: s.available + s.required, updatedAt: now });
    }
    if (menuStock.unresolved.length > 0) {
      console.warn(`[Cancel] Order ${orderId}: ${menuStock.unresolved.length} item(s) had no menu record; stock not restored for them.`);
    }

    const refundNeeded = order.paymentStatus === 'PAID' && refundAmount > 0;
    const paymentStatus = refundNeeded ? 'REFUND_PENDING' : String(order.paymentStatus);
    transaction.update(orderRef, {
      orderStatus: 'CANCELLED',
      paymentStatus,
      cancelledAt: now,
      cancelledBy: options.cancelledBy,
      updatedAt: now,
      ...(refundNeeded ? { refundId, refundAmount, refundStatus: 'REQUESTED' } : {}),
    });

    return { order, refundId, refundAmount, refundNeeded, alreadyCancelled: false, paymentStatus };
  });

  if (!phase.refundNeeded) {
    return {
      orderId,
      alreadyCancelled: phase.alreadyCancelled,
      paymentStatus: phase.paymentStatus,
      refundAmount: 0,
      message: phase.alreadyCancelled ? 'Order is already cancelled.' : 'Order cancelled.',
    };
  }

  const refund = await requestRefund(phase.order, orderId, phase.refundId, phase.refundAmount, refunds);
  const finalStatus = await recordRefundOutcome(orderId, phase.refundId, refund, firestore);

  return {
    orderId,
    alreadyCancelled: phase.alreadyCancelled,
    paymentStatus: finalStatus,
    refundAmount: phase.refundAmount,
    message: refundMessage(finalStatus, phase.refundAmount),
  };
}

async function recordRefundOutcome(
  orderId: string,
  refundId: string,
  refund: { paymentStatus: RefundPaymentStatus; refundStatus: string; cfRefundId?: string | null; error?: string | null },
  firestore: Firestore
): Promise<string> {
  const orderRef = firestore.collection('orders').doc(orderId);
  const now = new Date().toISOString();

  return firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(orderRef);
    const current = snap.data() || {};
    // Ignore outcomes for a different refund, and never downgrade a refund already confirmed.
    if (current.orderStatus !== 'CANCELLED' || (current.refundId && current.refundId !== refundId)) {
      return String(current.paymentStatus);
    }
    if (current.paymentStatus === 'REFUNDED') {
      return 'REFUNDED';
    }
    transaction.update(orderRef, {
      paymentStatus: refund.paymentStatus,
      refundStatus: refund.refundStatus,
      cfRefundId: refund.cfRefundId || current.cfRefundId || null,
      refundError: refund.error || null,
      refundUpdatedAt: now,
      updatedAt: now,
    });
    return refund.paymentStatus;
  });
}

/**
 * Applies a refund status confirmed by the gateway (e.g. from a verified refund webhook).
 */
export async function applyRefundStatus(
  orderId: string,
  refund: CashfreeRefund,
  firestore: Firestore = db
): Promise<string> {
  return recordRefundOutcome(
    orderId,
    refund.refundId,
    { paymentStatus: paymentStatusForRefund(refund.status), refundStatus: refund.status, cfRefundId: refund.cfRefundId },
    firestore
  );
}
