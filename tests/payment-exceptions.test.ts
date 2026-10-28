import './helpers/isolate-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeFirestore } from './helpers/fake-firestore';
import { CashfreeApiError } from '../lib/cashfree';
import { fulfillParentOrder } from '../lib/order-fulfillment';
import { refundIdForOrder, RefundClient } from '../lib/order-cancellation';
import { applyExceptionRefundStatus, listPaymentExceptions, refundPaymentException } from '../lib/payment-exceptions';
import { classifyCancelledOrder } from '../lib/refund-reconciliation';
import { publicHealthPayload } from '../lib/health';

const DATE = '2026-11-04';

/** A checkout that Cashfree reports as paid but whose meal sold out meanwhile. */
async function soldOutPayment(fs: FakeFirestore, orderId = 'ORD-X', amount = 120) {
  fs.seed('menus', `menu_${DATE}_primary`, { mealId: 'meal_pulao', date: DATE, studentCategory: 'Primary', availableQuantity: 0 });
  fs.seed('pending_orders', orderId, {
    id: orderId, parentId: 'par_1', totalAmount: amount, paymentMethod: 'UPI',
    cartItems: [{ studentId: 'stu_1', mealId: 'meal_pulao', date: DATE, studentCategory: 'Primary', quantity: 2, mealPrice: amount / 2 }],
  });
  const result = await fulfillParentOrder(orderId, { amount, currency: 'INR', transactionRef: 'cf_pay_1', cashfreeOrderId: 'cf_1' }, fs.asFirestore());
  assert.equal(result.reason, 'STOCK_UNAVAILABLE');
}

function refundClient(outcomes: Array<'SUCCESS' | 'PENDING' | 'CANCELLED' | Error>, getOutcome?: 'SUCCESS' | 'PENDING') {
  const calls: Array<{ refundId: string; amount: number }> = [];
  const client: RefundClient = {
    async create(params) {
      calls.push({ refundId: params.refundId, amount: params.amount });
      const outcome = outcomes.shift() ?? new Error('refund_id already exists');
      if (outcome instanceof Error) throw outcome;
      return { refundId: params.refundId, cfRefundId: 'cf_rf', status: outcome, amount: params.amount };
    },
    async get(_orderId, refundId) {
      if (!getOutcome) throw new CashfreeApiError('refund not found', 404, false);
      return { refundId, cfRefundId: 'cf_rf', status: getOutcome, amount: 120 };
    },
  };
  return { client, calls };
}

test('sold-out payment is refunded exactly once, even with concurrent webhook and verify calls', async () => {
  const fs = new FakeFirestore();
  await soldOutPayment(fs);
  const { client, calls } = refundClient(['PENDING']);
  const db = fs.asFirestore();

  const results = await Promise.all([
    refundPaymentException('ORD-X', {}, db, client),
    refundPaymentException('ORD-X', {}, db, client),
    refundPaymentException('ORD-X', {}, db, client),
  ]);
  await refundPaymentException('ORD-X', {}, db, client); // a later duplicate webhook

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { refundId: refundIdForOrder('ORD-X'), amount: 120 });
  assert.equal(results.filter((r) => r.requested).length, 1);
  assert.equal(fs.getDoc('payment_exceptions', 'ORD-X')?.refundState, 'REFUND_PENDING', 'not REFUNDED until Cashfree confirms');
});

test('the exception is only marked REFUNDED when the gateway confirms it', async () => {
  const fs = new FakeFirestore();
  await soldOutPayment(fs);
  const db = fs.asFirestore();
  await refundPaymentException('ORD-X', {}, db, refundClient(['PENDING']).client);

  const refundId = refundIdForOrder('ORD-X');
  await applyExceptionRefundStatus('ORD-X', { refundId: 'RF-other', cfRefundId: null, status: 'SUCCESS', amount: 120 }, db);
  assert.equal(fs.getDoc('payment_exceptions', 'ORD-X')?.refundState, 'REFUND_PENDING', 'a different refund is ignored');

  await applyExceptionRefundStatus('ORD-X', { refundId, cfRefundId: 'cf_rf', status: 'SUCCESS', amount: 120 }, db);
  assert.equal(fs.getDoc('payment_exceptions', 'ORD-X')?.refundState, 'REFUNDED');

  await applyExceptionRefundStatus('ORD-X', { refundId, cfRefundId: 'cf_rf', status: 'CANCELLED', amount: 120 }, db);
  assert.equal(fs.getDoc('payment_exceptions', 'ORD-X')?.refundState, 'REFUNDED', 'never downgraded');
});

test('a failed refund is not retried automatically; an admin retry reuses the same refund ID', async () => {
  const fs = new FakeFirestore();
  await soldOutPayment(fs);
  const db = fs.asFirestore();
  const { client, calls } = refundClient([new Error('gateway timeout'), 'SUCCESS']);

  const first = await refundPaymentException('ORD-X', {}, db, client);
  assert.equal(first.refundState, 'REFUND_FAILED');

  const automatic = await refundPaymentException('ORD-X', {}, db, client);
  assert.equal(automatic.requested, false);
  assert.equal(calls.length, 1);

  const manual = await refundPaymentException('ORD-X', { manual: true }, db, client);
  assert.equal(manual.refundState, 'REFUNDED');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].refundId, calls[1].refundId);

  const again = await refundPaymentException('ORD-X', { manual: true }, db, client);
  assert.equal(again.requested, false, 'a confirmed refund is never requested again');
  assert.equal(calls.length, 2);
});

test('amount-mismatch exceptions are never refunded automatically', async () => {
  const fs = new FakeFirestore();
  fs.seed('pending_orders', 'ORD-M', { id: 'ORD-M', parentId: 'par_1', totalAmount: 120, cartItems: [] });
  const db = fs.asFirestore();
  await fulfillParentOrder('ORD-M', { amount: 1, currency: 'INR' }, db);
  const { client, calls } = refundClient(['SUCCESS']);

  const auto = await refundPaymentException('ORD-M', {}, db, client);
  assert.equal(auto.requested, false);
  assert.equal(auto.refundState, 'MANUAL_REVIEW');
  assert.equal(calls.length, 0);

  const manual = await refundPaymentException('ORD-M', { manual: true }, db, client);
  assert.equal(manual.refundState, 'REFUNDED');
  assert.deepEqual(calls[0].amount, 1, 'refunds what was actually paid');
  assert.equal((await listPaymentExceptions(db)).length, 1);
});

test('historical cancellations are classified without guessing', () => {
  const order = { id: 'ORD-1', totalAmount: 120, paymentStatus: 'REFUNDED', cashfreeOrderId: 'cf_1' };
  const refund = (status: string, amount = 120) => ({ refundId: 'r', cfRefundId: null, status, amount });

  assert.equal(classifyCancelledOrder(order, null), 'NOT_CHECKED_LEGACY');
  assert.equal(classifyCancelledOrder({ ...order, refundId: 'RF-1' }, null), 'NOT_CHECKED_TRACKED');
  assert.equal(classifyCancelledOrder(order, []), 'MISSING_REFUND');
  assert.equal(classifyCancelledOrder(order, [refund('SUCCESS')]), 'CONFIRMED_REFUND');
  assert.equal(classifyCancelledOrder(order, [refund('SUCCESS', 50)]), 'PARTIAL_REFUND');
  assert.equal(classifyCancelledOrder(order, [refund('PENDING')]), 'REFUND_IN_PROGRESS');
  assert.equal(classifyCancelledOrder(order, [refund('CANCELLED')]), 'MISSING_REFUND');
  assert.equal(classifyCancelledOrder(order, 'ERROR'), 'LOOKUP_FAILED');
  assert.equal(classifyCancelledOrder({ ...order, cashfreeOrderId: null }, []), 'NO_GATEWAY_RECORD');
  assert.equal(classifyCancelledOrder({ ...order, paymentStatus: 'PENDING' }, []), 'NOT_PAID');
});

test('public health payload exposes only health booleans', () => {
  const unhealthy = publicHealthPayload({ configured: true, initError: null, dbConnected: false, dbError: '16 UNAUTHENTICATED: secret detail' }, 't');
  assert.deepEqual(unhealthy, { status: 'MISCONFIGURED', timestamp: 't', firebase: { isConfigured: true, isConnectedToDatabase: false } });
  const text = JSON.stringify(unhealthy);
  for (const leaked of ['UNAUTHENTICATED', 'projectId', 'environment', 'Key', 'nodeEnv']) {
    assert.equal(text.includes(leaked), false, leaked);
  }
  assert.equal(publicHealthPayload({ configured: true, initError: null, dbConnected: true, dbError: null }).status, 'HEALTHY');
});
