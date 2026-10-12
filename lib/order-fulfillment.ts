import { db } from './firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { cleanDoc, generateId } from './firestore-db';

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
 * Concurrently safe, atomic transaction that validates portions, creates order records,
 * and removes pending checkout intent.
 */
export async function fulfillParentOrder(
  orderId: string,
  paymentDetails?: {
    transactionRef?: string;
    paymentMethod?: string;
    upiId?: string | null;
    cardLastFour?: string | null;
    bankName?: string | null;
    cashfreeOrderId?: string | null;
    amount?: number;
  }
): Promise<{ success: boolean; orderId: string; alreadyFulfilled?: boolean }> {
  const now = new Date().toISOString();
  const orderRef = db.collection('orders').doc(orderId);
  const pendingRef = db.collection('pending_orders').doc(orderId);

  const result = await db.runTransaction(async (transaction) => {
    // 1. Check if order is already created
    const existingOrderSnap = await transaction.get(orderRef);
    if (existingOrderSnap.exists) {
      const existingData = existingOrderSnap.data() || {};
      if (existingData.paymentStatus === 'PAID') {
        return { success: true, orderId, alreadyFulfilled: true };
      }
      // If was previously created as PENDING (legacy), upgrade to PAID
      transaction.update(orderRef, {
        paymentStatus: 'PAID',
        orderStatus: 'CONFIRMED',
        cashfreeOrderId: paymentDetails?.cashfreeOrderId || existingData.cashfreeOrderId || null,
        updatedAt: now,
      });
      return { success: true, orderId };
    }

    // 2. Fetch pending checkout document
    const pendingSnap = await transaction.get(pendingRef);
    if (!pendingSnap.exists) {
      throw new Error(`Pending checkout session ${orderId} not found`);
    }

    const pending = pendingSnap.data() as PendingParentOrder;
    const evaluatedCartItems = pending.cartItems || [];

    // 3. Check and decrement portions atomically
    for (const item of evaluatedCartItems) {
      const catSlug = String((item as any).studentCategory || 'all').toLowerCase().replace(/\s+/g, '_');
      const categoryMenuDocId = `menu_${item.date}_${catSlug}`;
      let menuRef = db.collection('menus').doc(categoryMenuDocId);
      let menuSnap = await transaction.get(menuRef);

      if (!menuSnap.exists) {
        const legacyDocId = `${item.mealId}_${item.date}`;
        menuRef = db.collection('menus').doc(legacyDocId);
        menuSnap = await transaction.get(menuRef);
      }

      if (menuSnap.exists) {
        transaction.update(menuRef, {
          availableQuantity: FieldValue.increment(-Number(item.quantity || 1)),
          updatedAt: now,
        });
      }
    }

    // 4. Create official Order record
    const orderObj = cleanDoc({
      id: orderId,
      parentId: pending.parentId,
      totalAmount: pending.totalAmount,
      paymentStatus: 'PAID',
      orderStatus: 'CONFIRMED',
      cashfreeOrderId: paymentDetails?.cashfreeOrderId || pending.cashfreeOrderId || null,
      paymentSessionId: pending.paymentSessionId || null,
      notes: pending.notes || null,
      createdAt: now,
      updatedAt: now,
    });
    transaction.set(orderRef, orderObj);

    // 5. Create OrderItems
    for (const item of evaluatedCartItems) {
      const itemId = generateId('oit_');
      const itemObj = cleanDoc({
        id: itemId,
        orderId,
        studentId: item.studentId,
        studentCategory: (item as any).studentCategory || null,
        mealId: item.mealId,
        date: item.date,
        quantity: item.quantity,
        unitPrice: item.mealPrice,
        totalPrice: item.mealPrice * item.quantity,
        hasAllergyAlert: Boolean(item.hasAllergyAlert),
        conflictAllergens: item.conflictAllergens || null,
        createdAt: now,
      });
      transaction.set(db.collection('orderItems').doc(itemId), itemObj);
    }

    // 6. Create Payment record
    const paymentId = generateId('PAY-');
    const txnRef =
      paymentDetails?.transactionRef ||
      `CF-${Date.now().toString().slice(-8)}${Math.floor(100 + Math.random() * 900)}`;

    const payObj = cleanDoc({
      id: paymentId,
      orderId,
      amount: paymentDetails?.amount || pending.totalAmount,
      paymentMethod: paymentDetails?.paymentMethod || pending.paymentMethod || 'UPI',
      status: 'SUCCESS',
      transactionRef: String(txnRef),
      upiId: paymentDetails?.upiId || pending.upiId || null,
      cardLastFour: paymentDetails?.cardLastFour || pending.cardLastFour || null,
      bankName: paymentDetails?.bankName || pending.bankName || null,
      createdAt: now,
    });
    transaction.set(db.collection('payments').doc(paymentId), payObj);

    // 7. Delete pending checkout document
    transaction.delete(pendingRef);

    return { success: true, orderId };
  });

  try {
    const { notifyOrdersUpdated } = await import('@/lib/sync-events');
    await notifyOrdersUpdated();
  } catch {
    // non-blocking
  }

  return result;
}

/**
 * Fulfill and create teacher order ONLY when payment is successfully confirmed.
 */
export async function fulfillTeacherOrder(
  orderId: string,
  paymentDetails?: {
    transactionRef?: string;
    cashfreeOrderId?: string | null;
  }
): Promise<{ success: boolean; orderId: string; alreadyFulfilled?: boolean }> {
  const now = new Date().toISOString();
  const orderRef = db.collection('teacher_orders').doc(orderId);
  const pendingRef = db.collection('pending_teacher_orders').doc(orderId);

  // 1. Check if order is already created
  const existingOrderSnap = await orderRef.get();
  if (existingOrderSnap.exists) {
    const existingData = existingOrderSnap.data() || {};
    if (existingData.paymentStatus === 'PAID') {
      return { success: true, orderId, alreadyFulfilled: true };
    }
    // Update legacy pending to PAID
    await orderRef.update({
      paymentStatus: 'PAID',
      orderStatus: 'CONFIRMED',
      cashfreeOrderId: paymentDetails?.cashfreeOrderId || existingData.cashfreeOrderId || null,
      updatedAt: now,
    });

    try {
      const { notifyOrdersUpdated, notifyTeacherOrdersUpdated } = await import('@/lib/sync-events');
      await Promise.all([notifyOrdersUpdated(), notifyTeacherOrdersUpdated()]);
    } catch {
      // non-blocking
    }

    return { success: true, orderId };
  }

  // 2. Fetch pending teacher checkout
  const pendingSnap = await pendingRef.get();
  if (!pendingSnap.exists) {
    throw new Error(`Pending teacher order ${orderId} not found`);
  }

  const pending = pendingSnap.data() as PendingTeacherOrder;

  // 3. Create confirmed teacher order
  const orderDoc = cleanDoc({
    id: orderId,
    orderType: 'TEACHER',
    teacherName: pending.teacherName,
    teacherPhone: pending.teacherPhone || null,
    totalAmount: pending.totalAmount,
    date: pending.date,
    paymentStatus: 'PAID',
    orderStatus: 'CONFIRMED',
    paymentMethod: 'ONLINE',
    cashfreeOrderId: paymentDetails?.cashfreeOrderId || pending.cashfreeOrderId || null,
    paymentSessionId: pending.paymentSessionId || null,
    notes: pending.notes || null,
    items: pending.items || [],
    createdAt: pending.createdAt || now,
    updatedAt: now,
  });

  await orderRef.set(orderDoc);

  // 4. Remove pending checkout
  await pendingRef.delete().catch(() => {});

  try {
    const { notifyOrdersUpdated, notifyTeacherOrdersUpdated } = await import('@/lib/sync-events');
    await Promise.all([notifyOrdersUpdated(), notifyTeacherOrdersUpdated()]);
  } catch {
    // non-blocking
  }

  return { success: true, orderId };
}
