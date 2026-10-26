import './helpers/isolate-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeFirestore } from './helpers/fake-firestore';
import {
  applyRefundStatus,
  cancelOrderWithRefund,
  OrderCancellationError,
  paymentStatusForRefund,
  refundIdForOrder,
  RefundClient,
} from '../lib/order-cancellation';

const DATE = '2026-11-03';
const MENU_ID = `menu_${DATE}_pre_primary`;

function seedPaidOrder(fs: FakeFirestore, overrides: Record<string, any> = {}) {
  fs.seed('menus', MENU_ID, { id: MENU_ID, mealId: 'meal_upma', date: DATE, studentCategory: 'Pre-primary', availableQuantity: 10 });
  fs.seed('orders', 'ORD-1', {
    id: 'ORD-1', parentId: 'par_1', totalAmount: 120, paymentStatus: 'PAID', orderStatus: 'CONFIRMED', cashfreeOrderId: 'cf_1', ...overrides,
  });
  fs.seed('orderItems', 'oit_1', { id: 'oit_1', orderId: 'ORD-1', mealId: 'meal_upma', date: DATE, studentCategory: 'Pre-primary', menuId: MENU_ID, quantity: 1 });
  fs.seed('orderItems', 'oit_2', { id: 'oit_2', orderId: 'ORD-1', mealId: 'meal_upma', date: DATE, studentCategory: 'Pre-primary', quantity: 1 });
}

function refundClient(outcomes: Array<'SUCCESS' | 'PENDING' | 'CANCELLED' | Error>, getOutcome?: 'SUCCESS' | Error) {
  const calls: Array<{ orderId: string; refundId: string; amount: number }> = [];
  const client: RefundClient = {
    async create(params) {
      calls.push(params);
      const outcome = outcomes.shift() ?? new Error('no outcome configured');
      if (outcome instanceof Error) throw outcome;
      return { refundId: params.refundId, cfRefundId: 'cf_rf_1', status: outcome, amount: params.amount };
    },
    async get(_orderId, refundId) {
      if (!getOutcome || getOutcome instanceof Error) throw getOutcome || new Error('refund not found');
      return { refundId, cfRefundId: 'cf_rf_1', status: getOutcome, amount: 120 };
    },
  };
  return { client, calls };
}

test('successful refund: stock restored once to the right menu, then marked REFUNDED', async () => {
  const fs = new FakeFirestore();
  seedPaidOrder(fs);
  const { client, calls } = refundClient(['SUCCESS']);

  const result = await cancelOrderWithRefund({ orderId: 'ORD-1', parentId: 'par_1', cancelledBy: 'usr_1' }, fs.asFirestore(), client);

  assert.equal(result.paymentStatus, 'REFUNDED');
  assert.match(result.message, /refunded/);
  assert.deepEqual(calls, [{ orderId: 'ORD-1', refundId: refundIdForOrder('ORD-1'), amount: 120 }]);
  assert.equal(fs.getDoc('orders', 'ORD-1')?.orderStatus, 'CANCELLED');
  assert.equal(fs.getDoc('orders', 'ORD-1')?.paymentStatus, 'REFUNDED');
  // Both items (one with recorded menuId, one resolved via the canonical pre_primary ID)
  assert.equal(fs.getDoc('menus', MENU_ID)?.availableQuantity, 12);
});

test('pending refund is not reported as refunded', async () => {
  const fs = new FakeFirestore();
  seedPaidOrder(fs);
  const { client } = refundClient(['PENDING']);

  const result = await cancelOrderWithRefund({ orderId: 'ORD-1', cancelledBy: 'usr_admin' }, fs.asFirestore(), client);

  assert.equal(result.paymentStatus, 'REFUND_PENDING');
  assert.doesNotMatch(result.message, /refunded to/);
  assert.equal(fs.getDoc('orders', 'ORD-1')?.paymentStatus, 'REFUND_PENDING');
});

test('refund failure is recorded, and a retry reuses the refund ID without restoring stock again', async () => {
  const fs = new FakeFirestore();
  seedPaidOrder(fs);
  const db = fs.asFirestore();
  const { client, calls } = refundClient([new Error('gateway timeout'), 'SUCCESS']);

  const first = await cancelOrderWithRefund({ orderId: 'ORD-1', parentId: 'par_1', cancelledBy: 'usr_1' }, db, client);
  assert.equal(first.paymentStatus, 'REFUND_FAILED');
  assert.match(first.message, /could not be processed/);
  assert.equal(fs.getDoc('orders', 'ORD-1')?.orderStatus, 'CANCELLED');
  assert.equal(fs.getDoc('menus', MENU_ID)?.availableQuantity, 12);

  const retry = await cancelOrderWithRefund({ orderId: 'ORD-1', parentId: 'par_1', cancelledBy: 'usr_1' }, db, client);
  assert.equal(retry.paymentStatus, 'REFUNDED');
  assert.equal(retry.alreadyCancelled, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].refundId, calls[1].refundId);
  assert.equal(fs.getDoc('menus', MENU_ID)?.availableQuantity, 12, 'stock restored only once');
});

test('duplicate refund request falls back to reading the existing refund', async () => {
  const fs = new FakeFirestore();
  seedPaidOrder(fs, { orderStatus: 'CANCELLED', paymentStatus: 'REFUND_PENDING', refundId: refundIdForOrder('ORD-1') });
  const { client } = refundClient([new Error('refund_id already exists')], 'SUCCESS');

  const result = await cancelOrderWithRefund({ orderId: 'ORD-1', cancelledBy: 'usr_admin' }, fs.asFirestore(), client);

  assert.equal(result.paymentStatus, 'REFUNDED');
  assert.equal(fs.getDoc('menus', MENU_ID)?.availableQuantity, 10, 'already-cancelled order does not restore stock');
});

test('a parent cannot cancel another parent’s order', async () => {
  const fs = new FakeFirestore();
  seedPaidOrder(fs);
  const { client, calls } = refundClient(['SUCCESS']);

  await assert.rejects(
    cancelOrderWithRefund({ orderId: 'ORD-1', parentId: 'par_OTHER', cancelledBy: 'usr_2' }, fs.asFirestore(), client),
    (err: unknown) => err instanceof OrderCancellationError && err.status === 404
  );
  assert.equal(calls.length, 0);
  assert.equal(fs.getDoc('orders', 'ORD-1')?.orderStatus, 'CONFIRMED');
  assert.equal(fs.getDoc('menus', MENU_ID)?.availableQuantity, 10);
});

test('prepared or collected orders cannot be cancelled', async () => {
  const fs = new FakeFirestore();
  seedPaidOrder(fs, { orderStatus: 'READY' });
  const { client } = refundClient(['SUCCESS']);
  await assert.rejects(
    cancelOrderWithRefund({ orderId: 'ORD-1', parentId: 'par_1', cancelledBy: 'usr_1' }, fs.asFirestore(), client),
    OrderCancellationError
  );
  assert.equal(fs.getDoc('orders', 'ORD-1')?.paymentStatus, 'PAID');
});

test('refund webhooks only apply to the matching refund and never downgrade REFUNDED', async () => {
  const fs = new FakeFirestore();
  const refundId = refundIdForOrder('ORD-1');
  seedPaidOrder(fs, { orderStatus: 'CANCELLED', paymentStatus: 'REFUND_PENDING', refundId });
  const db = fs.asFirestore();

  await applyRefundStatus('ORD-1', { refundId: 'RF-someone-else', cfRefundId: null, status: 'SUCCESS', amount: 120 }, db);
  assert.equal(fs.getDoc('orders', 'ORD-1')?.paymentStatus, 'REFUND_PENDING');

  await applyRefundStatus('ORD-1', { refundId, cfRefundId: 'cf', status: 'SUCCESS', amount: 120 }, db);
  assert.equal(fs.getDoc('orders', 'ORD-1')?.paymentStatus, 'REFUNDED');

  await applyRefundStatus('ORD-1', { refundId, cfRefundId: 'cf', status: 'CANCELLED', amount: 120 }, db);
  assert.equal(fs.getDoc('orders', 'ORD-1')?.paymentStatus, 'REFUNDED');

  assert.equal(paymentStatusForRefund('ONHOLD'), 'REFUND_PENDING');
  assert.equal(paymentStatusForRefund('CANCELLED'), 'REFUND_FAILED');
});
