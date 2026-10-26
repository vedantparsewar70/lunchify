import crypto from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { db } from './firebase-admin';
import { cleanDoc, generateId } from './firestore-db';
import { collectMenuStockInTransaction } from './menu-stock';

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
}

export interface FulfillmentResult {
  success: boolean;
  orderId: string;
  alreadyFulfilled?: boolean;
  reason?: 'AMOUNT_MISMATCH' | 'STOCK_UNAVAILABLE' | 'ORDER_NOT_PAYABLE';
  message?: string;
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

  const result = await firestore.runTransaction(async (transaction): Promise<FulfillmentResult> => {
    // --- Reads ---
    const existingOrderSnap = await transaction.get(orderRef);
    const pendingSnap = await transaction.get(pendingRef);

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

    const mismatch = checkPaidAmount(payment, pending.totalAmount);
    if (mismatch) {
      // Returns immediately after this write, so no read follows it.
      transaction.update(pendingRef, {
        status: 'NEEDS_REVIEW',
        reviewReason: 'AMOUNT_MISMATCH',
        paidAmount: Number(payment.amount) || 0,
        updatedAt: now,
      });
      return { success: false, orderId, reason: 'AMOUNT_MISMATCH', message: mismatch };
    }

    const menuStock = await collectMenuStockInTransaction(
      transaction,
      firestore,
      cartItems.map((item: any) => ({
        mealId: item.mealId,
        date: item.date,
        quantity: Number(item.quantity || 1),
        studentCategory: item.studentCategory || null,
        menuId: item.menuId || null,
      }))
    );

    // --- Writes ---
    const insufficient =
      menuStock.unresolved.length > 0 || menuStock.stock.some((s) => s.available < s.required);
    if (insufficient) {
      // Payment was captured but the meals can no longer be supplied. Never oversell or go negative;
      // keep the checkout for canteen review and refund.
      transaction.update(pendingRef, {
        status: 'NEEDS_REVIEW',
        reviewReason: 'STOCK_UNAVAILABLE',
        paidAmount: Number(payment.amount) || 0,
        cashfreeOrderId: payment.cashfreeOrderId || pending.cashfreeOrderId || null,
        updatedAt: now,
      });
      return {
        success: false,
        orderId,
        reason: 'STOCK_UNAVAILABLE',
        message: 'Payment received, but one or more meals are no longer available. The order needs canteen review for a refund.',
      };
    }

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
    });
    transaction.set(orderRef, orderObj);

    cartItems.forEach((item: any, index: number) => {
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

    transaction.delete(pendingRef);

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

  const result = await firestore.runTransaction(async (transaction): Promise<FulfillmentResult> => {
    const existingOrderSnap = await transaction.get(orderRef);
    const pendingSnap = await transaction.get(pendingRef);

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

    const mismatch = checkPaidAmount(payment, pending.totalAmount);
    if (mismatch) {
      transaction.update(pendingRef, {
        status: 'NEEDS_REVIEW',
        reviewReason: 'AMOUNT_MISMATCH',
        paidAmount: Number(payment.amount) || 0,
        updatedAt: now,
      });
      return { success: false, orderId, reason: 'AMOUNT_MISMATCH', message: mismatch };
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
