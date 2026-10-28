import './helpers/isolate-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeFirestore } from './helpers/fake-firestore';
import {
  checkPaidAmount,
  fulfillParentOrder,
  fulfillTeacherOrder,
  generateParentOrderId,
} from '../lib/order-fulfillment';

const DATE = '2026-11-02';

function seedMenus(fs: FakeFirestore, primaryQty = 50, prePrimaryQty = 50) {
  fs.seed('menus', `menu_${DATE}_primary`, {
    id: `menu_${DATE}_primary`, mealId: 'meal_pulao', date: DATE, studentCategory: 'Primary', availableQuantity: primaryQty, isActive: true,
  });
  // Written by the October seeder with the "pre_primary" slug.
  fs.seed('menus', `menu_${DATE}_pre_primary`, {
    id: `menu_${DATE}_pre_primary`, mealId: 'meal_upma', date: DATE, studentCategory: 'Pre-primary', availableQuantity: prePrimaryQty, isActive: true,
  });
}

function seedPending(fs: FakeFirestore, orderId: string, cartItems: any[], totalAmount: number) {
  fs.seed('pending_orders', orderId, {
    id: orderId, parentId: 'par_1', totalAmount, paymentMethod: 'UPI', cartItems, status: 'PENDING_PAYMENT', createdAt: new Date().toISOString(),
  });
}

const line = (studentId: string, mealId: string, studentCategory: string, quantity: number, mealPrice = 60) => ({
  studentId, mealId, date: DATE, studentCategory, quantity, mealPrice,
});

test('multi-item cart is fulfilled in one transaction with all reads before writes', async () => {
  const fs = new FakeFirestore();
  seedMenus(fs);
  seedPending(fs, 'ORD-A', [line('stu_1', 'meal_pulao', 'Primary', 1), line('stu_2', 'meal_pulao', 'Primary', 2), line('stu_3', 'meal_upma', 'Pre-primary', 1)], 240);

  const result = await fulfillParentOrder('ORD-A', { amount: 240, currency: 'INR', transactionRef: 'cf_pay_1' }, fs.asFirestore());

  assert.equal(result.success, true);
  assert.equal(fs.getDoc('orders', 'ORD-A')?.paymentStatus, 'PAID');
  assert.equal(fs.list('orderItems').length, 3);
  assert.equal(fs.list('payments').length, 1);
  assert.equal(fs.getDoc('pending_orders', 'ORD-A'), undefined);
  // Stock aggregated per menu: 1 + 2 Primary, 1 Pre-primary
  assert.equal(fs.getDoc('menus', `menu_${DATE}_primary`)?.availableQuantity, 47);
  assert.equal(fs.getDoc('menus', `menu_${DATE}_pre_primary`)?.availableQuantity, 49);
  // Order items remember the exact menu document for later cancellation
  const preItem = fs.list('orderItems').find((i) => i.studentId === 'stu_3');
  assert.equal(preItem?.menuId, `menu_${DATE}_pre_primary`);
});

test('fake Firestore rejects reads after writes (guards the test above)', async () => {
  const fs = new FakeFirestore();
  seedMenus(fs);
  const db = fs.asFirestore();
  await assert.rejects(
    db.runTransaction(async (tx) => {
      tx.update(db.collection('menus').doc(`menu_${DATE}_primary`), { availableQuantity: 1 });
      await tx.get(db.collection('menus').doc(`menu_${DATE}_pre_primary`));
    }),
    /reads to be executed before all writes/
  );
});

test('cart lines for the same menu are aggregated and cannot oversell', async () => {
  const fs = new FakeFirestore();
  seedMenus(fs, 2);
  seedPending(fs, 'ORD-B', [line('stu_1', 'meal_pulao', 'Primary', 1), line('stu_2', 'meal_pulao', 'Primary', 2)], 180);

  const result = await fulfillParentOrder('ORD-B', { amount: 180, currency: 'INR' }, fs.asFirestore());

  assert.equal(result.success, false);
  assert.equal(result.reason, 'STOCK_UNAVAILABLE');
  assert.equal(fs.getDoc('menus', `menu_${DATE}_primary`)?.availableQuantity, 2, 'stock must not change or go negative');
  assert.equal(fs.getDoc('orders', 'ORD-B'), undefined);
  assert.equal(fs.getDoc('pending_orders', 'ORD-B')?.status, 'PAYMENT_EXCEPTION');
  assert.equal(result.exceptionRecorded, true);
});

test('a paid but sold-out checkout is recorded durably and never fulfilled later', async () => {
  const fs = new FakeFirestore();
  seedMenus(fs, 1);
  seedPending(fs, 'ORD-SO', [line('stu_1', 'meal_pulao', 'Primary', 2)], 120);
  const db = fs.asFirestore();
  const payment = { amount: 120, currency: 'INR', transactionRef: 'cf_pay_9', cashfreeOrderId: 'cf_9' };

  const first = await fulfillParentOrder('ORD-SO', payment, db);
  assert.equal(first.reason, 'STOCK_UNAVAILABLE');

  const exception = fs.getDoc('payment_exceptions', 'ORD-SO');
  assert.equal(exception?.reason, 'STOCK_UNAVAILABLE');
  assert.equal(exception?.paidAmount, 120);
  assert.equal(exception?.transactionRef, 'cf_pay_9');
  assert.equal(exception?.cashfreeOrderId, 'cf_9');
  assert.equal(exception?.refundState, 'NOT_REQUESTED');
  assert.equal(exception?.ownerId, 'par_1');
  assert.deepEqual(exception?.items.map((i: any) => i.quantity), [2]);

  // Stock frees up (e.g. a cancellation); a webhook retry must still not create the order,
  // because the payment is being refunded.
  fs.seed('menus', `menu_${DATE}_primary`, { ...fs.getDoc('menus', `menu_${DATE}_primary`), availableQuantity: 10 });
  const retry = await fulfillParentOrder('ORD-SO', payment, db);
  assert.equal(retry.success, false);
  assert.equal(fs.getDoc('orders', 'ORD-SO'), undefined);
  assert.equal(fs.getDoc('menus', `menu_${DATE}_primary`)?.availableQuantity, 10);
});

test('paid amount or currency that does not match the pending total is rejected', async () => {
  for (const payment of [{ amount: 1, currency: 'INR' }, { amount: 120, currency: 'USD' }, { amount: Number.NaN }]) {
    const fs = new FakeFirestore();
    seedMenus(fs);
    seedPending(fs, 'ORD-C', [line('stu_1', 'meal_pulao', 'Primary', 2)], 120);

    const result = await fulfillParentOrder('ORD-C', payment, fs.asFirestore());

    assert.equal(result.success, false);
    assert.equal(result.reason, 'AMOUNT_MISMATCH');
    assert.equal(fs.getDoc('orders', 'ORD-C'), undefined);
    assert.equal(fs.getDoc('menus', `menu_${DATE}_primary`)?.availableQuantity, 50);
    // Recorded for an admin decision; never refunded automatically
    assert.equal(fs.getDoc('payment_exceptions', 'ORD-C')?.refundState, 'MANUAL_REVIEW');
  }
  assert.equal(checkPaidAmount({ amount: 120 }, 120), null);
});

test('repeated webhook deliveries create exactly one order (sequential and concurrent)', async () => {
  const fs = new FakeFirestore();
  seedMenus(fs);
  seedPending(fs, 'ORD-D', [line('stu_1', 'meal_pulao', 'Primary', 1), line('stu_2', 'meal_upma', 'Pre-primary', 1)], 120);
  const db = fs.asFirestore();
  const payment = { amount: 120, currency: 'INR', transactionRef: 'cf_pay_2' };

  const concurrent = await Promise.all([
    fulfillParentOrder('ORD-D', payment, db),
    fulfillParentOrder('ORD-D', payment, db),
    fulfillParentOrder('ORD-D', payment, db),
  ]);
  const later = await fulfillParentOrder('ORD-D', payment, db);

  assert.equal(concurrent.filter((r) => r.success && !r.alreadyFulfilled).length, 1);
  assert.equal(later.alreadyFulfilled, true);
  assert.equal(fs.list('orders').length, 1);
  assert.equal(fs.list('orderItems').length, 2);
  assert.equal(fs.list('payments').length, 1);
  assert.equal(fs.getDoc('menus', `menu_${DATE}_primary`)?.availableQuantity, 49);
  assert.equal(fs.getDoc('menus', `menu_${DATE}_pre_primary`)?.availableQuantity, 49);
});

test('a late payment event never revives a cancelled order', async () => {
  const fs = new FakeFirestore();
  fs.seed('orders', 'ORD-E', { id: 'ORD-E', parentId: 'par_1', totalAmount: 60, paymentStatus: 'REFUND_PENDING', orderStatus: 'CANCELLED' });

  const result = await fulfillParentOrder('ORD-E', { amount: 60, currency: 'INR' }, fs.asFirestore());

  assert.equal(result.success, false);
  assert.equal(result.reason, 'ORDER_NOT_PAYABLE');
  assert.equal(fs.getDoc('orders', 'ORD-E')?.orderStatus, 'CANCELLED');
  assert.equal(fs.getDoc('orders', 'ORD-E')?.paymentStatus, 'REFUND_PENDING');
});

test('teacher fulfilment is idempotent and checks the amount', async () => {
  const fs = new FakeFirestore();
  const pendingTeacher = (id: string) => ({
    id, orderType: 'TEACHER', userId: 'usr_staff', teacherName: 'T', totalAmount: 140, date: DATE, items: [], createdAt: 'x', updatedAt: 'x',
  });
  fs.seed('pending_teacher_orders', 'TCH-0', pendingTeacher('TCH-0'));
  fs.seed('pending_teacher_orders', 'TCH-1', pendingTeacher('TCH-1'));
  const db = fs.asFirestore();

  assert.equal((await fulfillTeacherOrder('TCH-0', { amount: 1, currency: 'INR' }, db)).reason, 'AMOUNT_MISMATCH');
  assert.equal(fs.getDoc('teacher_orders', 'TCH-0'), undefined);
  assert.equal(fs.getDoc('payment_exceptions', 'TCH-0')?.orderType, 'TEACHER');

  const [a, b] = await Promise.all([
    fulfillTeacherOrder('TCH-1', { amount: 140, currency: 'INR' }, db),
    fulfillTeacherOrder('TCH-1', { amount: 140, currency: 'INR' }, db),
  ]);
  assert.equal([a, b].filter((r) => r.success && !r.alreadyFulfilled).length, 1);
  assert.equal(fs.getDoc('teacher_orders', 'TCH-1')?.paymentStatus, 'PAID');
  assert.equal(fs.getDoc('teacher_orders', 'TCH-1')?.userId, 'usr_staff');
});

test('parent order IDs are server-generated and scoped to the parent', () => {
  const a = generateParentOrderId('par_1', 'client-key-1');
  assert.equal(a, generateParentOrderId('par_1', 'client-key-1'), 'retries of one checkout map to one order');
  assert.notEqual(a, generateParentOrderId('par_2', 'client-key-1'), 'another parent cannot address the same order');
  assert.notEqual(a, 'client-key-1');
  assert.notEqual(generateParentOrderId('par_1'), generateParentOrderId('par_1'));
  for (const id of [a, generateParentOrderId('par_1')]) {
    assert.match(id, /^ORD-[A-F0-9]{24}$/);
  }
});
