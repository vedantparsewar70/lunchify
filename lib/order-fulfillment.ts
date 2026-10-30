import crypto from 'crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { db } from './firebase-admin';
import { cleanDoc, generateId } from './firestore-db';
import { collectMenuStockInTransaction } from './menu-stock';
import { isDeadlinePassed } from './utils';
import {
  isAcceptableReason,
  PAYMENT_EXCEPTIONS,
  PaymentReviewError,
  recordPaymentException,
  type ExceptionReason,
} from './payment-exceptions';

export interface PendingParentOrder {
  id: string;
  parentId: string;
  totalAmount: number;
  paymentMethod: string;
  upiId?: string | null;
  cardLastFour?: string | null;
  bankName?: string | null;
  notes?: string | null;
  cartItems: any[];
  cashfreeOrderId?: string | null;
  paymentSessionId?: string | null;
  createdAt: string;
}

export interface PendingTeacherOrder {
  id: string;
  orderType: 'TEACHER';
  userId?: string | null;
  teacherName: string;
  teacherPhone?: string | null;
  totalAmount: number;
  date: string;
  paymentMethod: string;
  cashfreeOrderId?: string | null;
  paymentSessionId?: string | null;
  notes?: string | null;
  items: any[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Payment details confirmed by the payment gateway (not by the client).
 * amount and currency are checked against the pending order total before fulfilment.
 */
export interface VerifiedPaymentDetails {
  amount: number;
  currency?: string;
  transactionRef?: string;
  paymentMethod?: string;
  upiId?: string | null;
  cardLastFour?: string | null;
  bankName?: string | null;
  cashfreeOrderId?: string | null;
  /** Gateway time the payment completed (ISO). Service-date rules are judged at this moment. */
  paidAt?: string | null;
}

export interface FulfillmentResult {
  success: boolean;
  orderId: string;
  alreadyFulfilled?: boolean;
  reason?: ExceptionReason | 'ORDER_NOT_PAYABLE';
  message?: string;
  /** A payment exception exists for this order (see lib/payment-exceptions.ts). */
  exceptionRecorded?: boolean;
}

/**
 * Server-generated parent order ID. A client idempotency key only makes the ID deterministic
 * for retries of the same checkout; it is hashed with the parent ID, so it can never select
 * or overwrite another parent's order.
 */
export function generateParentOrderId(parentId: string, idempotencyKey?: string | null): string {
  if (idempotencyKey) {
    const digest = crypto.createHash('sha256').update(`${parentId}:${idempotencyKey}`).digest('hex');
    return `ORD-${digest.slice(0, 24).toUpperCase()}`;
  }
  return `ORD-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
}

/**
 * Returns a description of the problem when the paid amount/currency does not match the expected total.
 */
export function checkPaidAmount(payment: VerifiedPaymentDetails, expectedTotal: number): string | null {
  const currency = String(payment.currency || 'INR').toUpperCase();
  if (currency !== 'INR') {
    return `Unexpected payment currency ${currency}`;
  }
  const paid = Number(payment.amount);
  const expected = Number(expectedTotal);
  if (!Number.isFinite(paid) || !Number.isFinite(expected) || expected <= 0 || Math.abs(paid - expected) >= 0.01) {
    return `Paid amount ${paid} does not match expected amount ${expected}`;
  }
  return null;
}

/**
 * Save pending parent checkout without creating any confirmed order or deducting stock.
 */
export async function savePendingParentOrder(data: PendingParentOrder): Promise<void> {
  const doc = cleanDoc({
    ...data,
    status: 'PENDING_PAYMENT',
    updatedAt: new Date().toISOString(),
  });
  await db.collection('pending_orders').doc(data.id).set(doc);
}

/**
 * Save pending teacher checkout without creating any order in teacher_orders.
 */
export async function savePendingTeacherOrder(data: PendingTeacherOrder): Promise<void> {
  const doc = cleanDoc({
    ...data,
    status: 'PENDING_PAYMENT',
    updatedAt: new Date().toISOString(),
  });
  await db.collection('pending_teacher_orders').doc(data.id).set(doc);
}

function paymentCompletedAt(payment: VerifiedPaymentDetails): Date {
  const parsed = payment.paidAt ? new Date(payment.paidAt) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

/**
 * Why a paid menu line can no longer be served automatically at `paidAt`, or null if it can.
 * PAID_AFTER_CUTOFF: the payment completed after that date's ordering deadline.
 * SERVICE_UNAVAILABLE: the date became a holiday, or the menu was disabled or removed.
 */
export function serviceProblem(
  menu: { date?: string; isActive?: boolean; isHoliday?: boolean; orderingDeadline?: string } | undefined,
  paidAt: Date
): { reason: 'PAID_AFTER_CUTOFF' | 'SERVICE_UNAVAILABLE'; detail: string } | null {
  if (!menu) return { reason: 'SERVICE_UNAVAILABLE', detail: 'menu not found' };
  if (menu.isHoliday) return { reason: 'SERVICE_UNAVAILABLE', detail: 'the date is a holiday' };
  if (menu.isActive === false) return { reason: 'SERVICE_UNAVAILABLE', detail: 'the menu was disabled by the canteen' };
  if (menu.date && isDeadlinePassed(menu.date, menu.orderingDeadline || '08:30', paidAt)) {
    return {
      reason: 'PAID_AFTER_CUTOFF',
      detail: `paid after the ${menu.orderingDeadline || '08:30'} ordering deadline for ${menu.date}`,
    };
  }
  return null;
}

type MenuStockCheck = Awaited<ReturnType<typeof collectMenuStockInTransaction>>;

function stockLines(
  cartItems: Array<{ mealId: string; date: string; quantity?: number; studentCategory?: string | null; menuId?: string | null }>
) {
  return cartItems.map((item) => ({
    mealId: item.mealId,
    date: item.date,
    quantity: Number(item.quantity || 1),
    studentCategory: item.studentCategory || null,
    menuId: item.menuId || null,
  }));
}

/**
 * Transaction writes that turn a paid checkout into an order: stock, order, items, payment record,
 * and removal of the pending checkout. The caller has done all reads and checks.
 */
function writeParentOrder(
  transaction: Transaction,
  firestore: Firestore,
  orderId: string,
  pending: PendingParentOrder,
  payment: VerifiedPaymentDetails,
  menuStock: MenuStockCheck,
  now: string,
  extra: Record<string, unknown> = {}
): void {
  for (const s of menuStock.stock) {
    transaction.update(s.ref, {
      availableQuantity: s.available - s.required,
      updatedAt: now,
    });
  }

  const orderObj = cleanDoc({
    id: orderId,
    parentId: pending.parentId,
    totalAmount: pending.totalAmount,
    paymentStatus: 'PAID',
    orderStatus: 'CONFIRMED',
    cashfreeOrderId: payment.cashfreeOrderId || pending.cashfreeOrderId || null,
    paymentSessionId: pending.paymentSessionId || null,
    notes: pending.notes || null,
    createdAt: now,
    updatedAt: now,
    ...extra,
  });
  transaction.set(firestore.collection('orders').doc(orderId), orderObj);

  (pending.cartItems || []).forEach((item: any, index: number) => {
    const itemId = generateId('oit_');
    const itemObj = cleanDoc({
      id: itemId,
      orderId,
      studentId: item.studentId,
      studentCategory: item.studentCategory || null,
      mealId: item.mealId,
      menuId: menuStock.lineMenuIds[index],
      date: item.date,
      quantity: item.quantity,
      unitPrice: item.mealPrice,
      totalPrice: item.mealPrice * item.quantity,
      hasAllergyAlert: Boolean(item.hasAllergyAlert),
      conflictAllergens: item.conflictAllergens || null,
      createdAt: now,
    });
    transaction.set(firestore.collection('orderItems').doc(itemId), itemObj);
  });

  const paymentId = generateId('PAY-');
  const payObj = cleanDoc({
    id: paymentId,
    orderId,
    amount: Number(payment.amount),
    paymentMethod: payment.paymentMethod || pending.paymentMethod || 'UPI',
    status: 'SUCCESS',
    transactionRef: String(payment.transactionRef || payment.cashfreeOrderId || orderId),
    upiId: payment.upiId || pending.upiId || null,
    cardLastFour: payment.cardLastFour || pending.cardLastFour || null,
    bankName: payment.bankName || pending.bankName || null,
    createdAt: now,
  });
  transaction.set(firestore.collection('payments').doc(paymentId), payObj);

  transaction.delete(firestore.collection('pending_orders').doc(orderId));
}

/**
 * Fulfill and create parent order ONLY when payment is successfully confirmed.
 * Single atomic transaction: all reads (order, pending checkout, menu stock) happen before
 * any write, stock is checked per menu across the whole cart, and repeated calls for the
 * same order (duplicate webhooks, verify + webhook) are no-ops once the order exists.
 */
export async function fulfillParentOrder(
  orderId: string,
  payment: VerifiedPaymentDetails,
  firestore: Firestore = db
): Promise<FulfillmentResult> {
  const now = new Date().toISOString();
  const orderRef = firestore.collection('orders').doc(orderId);
  const pendingRef = firestore.collection('pending_orders').doc(orderId);

  const exceptionRef = firestore.collection(PAYMENT_EXCEPTIONS).doc(orderId);

  const result = await firestore.runTransaction(async (transaction): Promise<FulfillmentResult> => {
    // --- Reads ---
    const existingOrderSnap = await transaction.get(orderRef);
    const pendingSnap = await transaction.get(pendingRef);
    const exceptionSnap = await transaction.get(exceptionRef);

    if (existingOrderSnap.exists) {
      const existingData = existingOrderSnap.data() || {};
      if (existingData.paymentStatus === 'PAID') {
        return { success: true, orderId, alreadyFulfilled: true };
      }
      if (existingData.paymentStatus !== 'PENDING') {
        // Cancelled, refunded or failed orders must never be flipped back to PAID by a late delivery.
        return { success: false, orderId, reason: 'ORDER_NOT_PAYABLE', message: `Order is ${existingData.paymentStatus}` };
      }
      // Legacy order created as PENDING before payment: upgrade only if the amount matches.
      const mismatch = checkPaidAmount(payment, existingData.totalAmount);
      if (mismatch) {
        return { success: false, orderId, reason: 'AMOUNT_MISMATCH', message: mismatch };
      }
      transaction.update(orderRef, {
        paymentStatus: 'PAID',
        orderStatus: 'CONFIRMED',
        cashfreeOrderId: payment.cashfreeOrderId || existingData.cashfreeOrderId || null,
        updatedAt: now,
      });
      return { success: true, orderId };
    }

    if (!pendingSnap.exists) {
      throw new Error(`Pending checkout session ${orderId} not found`);
    }

    const pending = pendingSnap.data() as PendingParentOrder;
    const cartItems = pending.cartItems || [];

    // A recorded payment exception is final: retries must never create the order afterwards
    // (the payment may already be refunded).
    if (exceptionSnap.exists) {
      const exception = exceptionSnap.data() || {};
      return { success: false, orderId, reason: exception.reason, message: 'Payment exception already recorded', exceptionRecorded: true };
    }

    const mismatch = checkPaidAmount(payment, pending.totalAmount);
    if (mismatch) {
      // Returns immediately after these writes, so no read follows them.
      recordPaymentException(transaction, exceptionRef, pendingRef, {
        orderId, orderType: 'PARENT', ownerId: pending.parentId, reason: 'AMOUNT_MISMATCH', detail: mismatch,
        expectedAmount: pending.totalAmount, payment, cashfreeOrderId: pending.cashfreeOrderId, items: cartItems, now,
      });
      return { success: false, orderId, reason: 'AMOUNT_MISMATCH', message: mismatch, exceptionRecorded: true };
    }

    const menuStock = await collectMenuStockInTransaction(transaction, firestore, stockLines(cartItems));

    // --- Writes ---
    // The meal must still be servable when the payment completed: menu active, not a holiday,
    // and paid before that date's ordering deadline. Otherwise the payment becomes an exception
    // that an admin reviews (accept as an order, or refund); it is never refunded automatically.
    const paidAt = paymentCompletedAt(payment);
    const problem = menuStock.stock.map((s) => serviceProblem(s.menu, paidAt)).find(Boolean);
    if (problem) {
      recordPaymentException(transaction, exceptionRef, pendingRef, {
        orderId, orderType: 'PARENT', ownerId: pending.parentId, reason: problem.reason, detail: problem.detail,
        expectedAmount: pending.totalAmount, payment, cashfreeOrderId: pending.cashfreeOrderId, items: cartItems, now,
      });
      return {
        success: false,
        orderId,
        reason: problem.reason,
        message: `Payment received, but the order needs review by the canteen (${problem.detail}).`,
        exceptionRecorded: true,
      };
    }

    const insufficient =
      menuStock.unresolved.length > 0 || menuStock.stock.some((s) => s.available < s.required);
    if (insufficient) {
      // Payment was captured but the meals can no longer be supplied. Never oversell or go negative;
      // record a durable exception so the payment is refunded (see refundPaymentException).
      recordPaymentException(transaction, exceptionRef, pendingRef, {
        orderId, orderType: 'PARENT', ownerId: pending.parentId, reason: 'STOCK_UNAVAILABLE',
        detail: 'One or more meals sold out before the paid order could be confirmed',
        expectedAmount: pending.totalAmount, payment, cashfreeOrderId: pending.cashfreeOrderId, items: cartItems, now,
      });
      return {
        success: false,
        orderId,
        reason: 'STOCK_UNAVAILABLE',
        message: 'Payment received, but one or more meals are no longer available.',
        exceptionRecorded: true,
      };
    }

    writeParentOrder(transaction, firestore, orderId, pending, payment, menuStock, now);
    return { success: true, orderId };
  });

  if (result.success && !result.alreadyFulfilled) {
    try {
      const { notifyOrdersUpdated } = await import('@/lib/sync-events');
      await notifyOrdersUpdated();
    } catch {
      // non-blocking
    }
  }

  return result;
}

/**
 * Admin decision on a payment under review (paid after the cutoff, or the meal is no longer
 * served): accept it as a normal order. Runs in one transaction on the same exception document as
 * the refund claim, so a payment is either accepted or refunded, never both. Stock is still enforced.
 */
export async function acceptPaymentException(
  orderId: string,
  actorId: string,
  firestore: Firestore = db
): Promise<{ orderId: string; alreadyAccepted: boolean }> {
  const now = new Date().toISOString();
  const exceptionRef = firestore.collection(PAYMENT_EXCEPTIONS).doc(orderId);
  const orderRef = firestore.collection('orders').doc(orderId);
  const pendingRef = firestore.collection('pending_orders').doc(orderId);

  const result = await firestore.runTransaction(async (transaction) => {
    const exceptionSnap = await transaction.get(exceptionRef);
    const orderSnap = await transaction.get(orderRef);
    const pendingSnap = await transaction.get(pendingRef);
    if (!exceptionSnap.exists) throw new PaymentReviewError('Payment exception not found', 404);
    const exception = exceptionSnap.data() || {};

    if (exception.refundState === 'ORDER_ACCEPTED') return { orderId, alreadyAccepted: true };
    if (exception.orderType !== 'PARENT' || !isAcceptableReason(exception.reason)) {
      throw new PaymentReviewError('Only payments made after the cutoff or for a meal no longer served can be accepted as orders.');
    }
    if (exception.refundState !== 'MANUAL_REVIEW') {
      throw new PaymentReviewError('A refund has already been requested for this payment, so it can no longer be accepted as an order.');
    }
    if (orderSnap.exists) throw new PaymentReviewError('An order already exists for this payment.');
    if (!pendingSnap.exists) throw new PaymentReviewError('The checkout details for this payment are missing; refund it instead.');

    const pending = pendingSnap.data() as PendingParentOrder;
    const payment: VerifiedPaymentDetails = {
      amount: Number(exception.paidAmount),
      currency: exception.currency || 'INR',
      transactionRef: exception.transactionRef || undefined,
      cashfreeOrderId: exception.cashfreeOrderId || pending.cashfreeOrderId || null,
    };
    if (checkPaidAmount(payment, pending.totalAmount)) {
      throw new PaymentReviewError('The paid amount does not match the order total; refund it instead.');
    }

    const menuStock = await collectMenuStockInTransaction(transaction, firestore, stockLines(pending.cartItems || []));
    if (menuStock.unresolved.length > 0 || menuStock.stock.some((s) => s.available < s.required)) {
      throw new PaymentReviewError('Not enough meals are left to accept this order; refund it instead.');
    }

    writeParentOrder(transaction, firestore, orderId, pending, payment, menuStock, now, {
      acceptedFromReview: true,
      acceptedBy: actorId,
      acceptedAt: now,
    });
    transaction.update(exceptionRef, {
      refundState: 'ORDER_ACCEPTED',
      resolution: 'ACCEPTED_AS_ORDER',
      reviewedBy: actorId,
      reviewedAt: now,
      updatedAt: now,
    });
    return { orderId, alreadyAccepted: false };
  });

  if (!result.alreadyAccepted) {
    try {
      const { notifyOrdersUpdated } = await import('@/lib/sync-events');
      await notifyOrdersUpdated();
    } catch {
      // non-blocking
    }
  }
  return result;
}

/**
 * Fulfill and create teacher order ONLY when payment is successfully confirmed.
 * Atomic and idempotent: repeated calls return alreadyFulfilled once the order exists.
 */
export async function fulfillTeacherOrder(
  orderId: string,
  payment: VerifiedPaymentDetails,
  firestore: Firestore = db
): Promise<FulfillmentResult> {
  const now = new Date().toISOString();
  const orderRef = firestore.collection('teacher_orders').doc(orderId);
  const pendingRef = firestore.collection('pending_teacher_orders').doc(orderId);
  const exceptionRef = firestore.collection(PAYMENT_EXCEPTIONS).doc(orderId);

  const result = await firestore.runTransaction(async (transaction): Promise<FulfillmentResult> => {
    const existingOrderSnap = await transaction.get(orderRef);
    const pendingSnap = await transaction.get(pendingRef);
    const exceptionSnap = await transaction.get(exceptionRef);

    if (existingOrderSnap.exists) {
      const existingData = existingOrderSnap.data() || {};
      if (existingData.paymentStatus === 'PAID') {
        return { success: true, orderId, alreadyFulfilled: true };
      }
      if (existingData.paymentStatus !== 'PENDING') {
        return { success: false, orderId, reason: 'ORDER_NOT_PAYABLE', message: `Order is ${existingData.paymentStatus}` };
      }
      const mismatch = checkPaidAmount(payment, existingData.totalAmount);
      if (mismatch) {
        return { success: false, orderId, reason: 'AMOUNT_MISMATCH', message: mismatch };
      }
      transaction.update(orderRef, {
        paymentStatus: 'PAID',
        orderStatus: 'CONFIRMED',
        cashfreeOrderId: payment.cashfreeOrderId || existingData.cashfreeOrderId || null,
        updatedAt: now,
      });
      return { success: true, orderId };
    }

    if (!pendingSnap.exists) {
      throw new Error(`Pending teacher order ${orderId} not found`);
    }

    const pending = pendingSnap.data() as PendingTeacherOrder;

    if (exceptionSnap.exists) {
      const exception = exceptionSnap.data() || {};
      return { success: false, orderId, reason: exception.reason, message: 'Payment exception already recorded', exceptionRecorded: true };
    }

    const mismatch = checkPaidAmount(payment, pending.totalAmount);
    if (mismatch) {
      recordPaymentException(transaction, exceptionRef, pendingRef, {
        orderId, orderType: 'TEACHER', ownerId: pending.userId || null, reason: 'AMOUNT_MISMATCH', detail: mismatch,
        expectedAmount: pending.totalAmount, payment, cashfreeOrderId: pending.cashfreeOrderId, items: pending.items || [], now,
      });
      return { success: false, orderId, reason: 'AMOUNT_MISMATCH', message: mismatch, exceptionRecorded: true };
    }

    const orderDoc = cleanDoc({
      id: orderId,
      orderType: 'TEACHER',
      userId: pending.userId || null,
      teacherName: pending.teacherName,
      teacherPhone: pending.teacherPhone || null,
      totalAmount: pending.totalAmount,
      date: pending.date,
      paymentStatus: 'PAID',
      orderStatus: 'CONFIRMED',
      paymentMethod: 'ONLINE',
      transactionRef: payment.transactionRef || null,
      cashfreeOrderId: payment.cashfreeOrderId || pending.cashfreeOrderId || null,
      paymentSessionId: pending.paymentSessionId || null,
      notes: pending.notes || null,
      items: pending.items || [],
      createdAt: pending.createdAt || now,
      updatedAt: now,
    });

    transaction.set(orderRef, orderDoc);
    transaction.delete(pendingRef);

    return { success: true, orderId };
  });

  if (result.success && !result.alreadyFulfilled) {
    try {
      const { notifyOrdersUpdated, notifyTeacherOrdersUpdated } = await import('@/lib/sync-events');
      await Promise.all([notifyOrdersUpdated(), notifyTeacherOrdersUpdated()]);
    } catch {
      // non-blocking
    }
  }

  return result;
}
