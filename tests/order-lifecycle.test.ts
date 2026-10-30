import './helpers/isolate-env';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeFirestore } from './helpers/fake-firestore';
import { jsonRequest, signedInAs, useFakeFirestore } from './helpers/session';
import { setFirestoreForTesting } from '../lib/firebase-admin';
import { PATCH as updateOrder } from '../app/api/admin/orders/route';
import { PATCH as kitchenUpdate } from '../app/api/admin/kitchen/route';
import { PATCH as teacherOrderUpdate } from '../app/api/staff/teacher-orders/route';
import { GET as listExceptions, POST as refundException } from '../app/api/admin/payment-exceptions/route';
import { PATCH as cancelOwnOrder } from '../app/api/parent/orders/route';

let fs: FakeFirestore;
let staff: Record<string, string>;
let admin: Record<string, string>;
let parent: Record<string, string>;

function seedOrder(id: string, fields: Record<string, unknown>, date = '2099-01-05') {
  fs.seed('orders', id, { id, parentId: 'par_usr_parent', totalAmount: 80, paymentStatus: 'PAID', orderStatus: 'CONFIRMED', ...fields });
  fs.seed('orderItems', `oit_${id}`, { id: `oit_${id}`, orderId: id, mealId: 'meal_soya', date, quantity: 1, studentCategory: 'Primary' });
}

beforeEach(async () => {
  fs = useFakeFirestore();
  staff = await signedInAs(fs, 'STAFF');
  admin = await signedInAs(fs, 'ADMIN');
  parent = await signedInAs(fs, 'PARENT');
});

afterEach(() => setFirestoreForTesting(null));

const patch = (handler: (req: Request) => Promise<Response>, url: string, body: unknown, headers: Record<string, string>) =>
  handler(jsonRequest(url, 'PATCH', body, headers));

test('a handed-over meal can be un-given by staff but never cancelled and refunded by staff', async () => {
  seedOrder('ORD-1', {});
  assert.equal((await patch(updateOrder, '/api/admin/orders', { orderId: 'ORD-1', orderStatus: 'COLLECTED' }, staff)).status, 200);
  assert.ok(fs.getDoc('orders', 'ORD-1')?.collectedAt);
  assert.equal((await patch(updateOrder, '/api/admin/orders', { orderId: 'ORD-1', orderStatus: 'COLLECTED' }, staff)).status, 409, 'no double handover');

  assert.equal((await patch(updateOrder, '/api/admin/orders', { orderId: 'ORD-1', orderStatus: 'CONFIRMED' }, staff)).status, 200, 'undo allowed');
  const cancel = await patch(updateOrder, '/api/admin/orders', { orderId: 'ORD-1', orderStatus: 'CANCELLED' }, staff);
  assert.equal(cancel.status, 403);
  assert.equal(fs.getDoc('orders', 'ORD-1')?.paymentStatus, 'PAID', 'no refund started');

  // The parent cannot self-cancel it either.
  const own = await patch(cancelOwnOrder, '/api/parent/orders', { orderId: 'ORD-1', action: 'CANCEL' }, parent);
  assert.notEqual(own.status, 200);
  assert.equal(fs.getDoc('orders', 'ORD-1')?.orderStatus, 'CONFIRMED');

  // An admin may deliberately cancel it (refund handled by the normal refund flow).
  const byAdmin = await patch(updateOrder, '/api/admin/orders', { orderId: 'ORD-1', orderStatus: 'CANCELLED' }, admin);
  assert.notEqual(byAdmin.status, 403);
});

test('only paid orders can be prepared or handed over', async () => {
  seedOrder('ORD-P', { paymentStatus: 'PENDING' });
  seedOrder('ORD-R', { paymentStatus: 'REFUNDED', orderStatus: 'CONFIRMED' });
  for (const id of ['ORD-P', 'ORD-R']) {
    for (const orderStatus of ['READY', 'COLLECTED']) {
      const res = await patch(updateOrder, '/api/admin/orders', { orderId: id, orderStatus }, staff);
      assert.equal(res.status, 400, `${id} -> ${orderStatus}`);
    }
  }
  const missing = await patch(updateOrder, '/api/admin/orders', { orderId: 'ORD-NOPE', orderStatus: 'READY' }, staff);
  assert.equal(missing.status, 404);
  assert.doesNotMatch(JSON.stringify(await missing.json()), /Error:|stack/);
});

test('kitchen bulk updates only move paid, active orders and never resurrect cancelled ones', async () => {
  seedOrder('ORD-A', {});
  seedOrder('ORD-X', { orderStatus: 'CANCELLED', paymentStatus: 'REFUNDED' });
  seedOrder('ORD-U', { paymentStatus: 'PENDING' });
  seedOrder('ORD-G', { orderStatus: 'COLLECTED', collectedAt: '2099-01-05T03:00:00Z' });

  const res = await patch(kitchenUpdate, '/api/admin/kitchen', { date: '2099-01-05', status: 'COLLECTED' }, staff);
  assert.equal(res.status, 200);
  assert.equal(fs.getDoc('orders', 'ORD-A')?.orderStatus, 'COLLECTED');
  assert.ok(fs.getDoc('orders', 'ORD-A')?.collectedAt);
  assert.equal(fs.getDoc('orders', 'ORD-X')?.orderStatus, 'CANCELLED');
  assert.equal(fs.getDoc('orders', 'ORD-U')?.orderStatus, 'CONFIRMED');
  assert.equal(fs.getDoc('orders', 'ORD-G')?.collectedAt, '2099-01-05T03:00:00Z', 'existing handover untouched');

  assert.equal((await patch(kitchenUpdate, '/api/admin/kitchen', { orderIds: ['ORD-X'], status: 'READY' }, staff)).status, 200);
  assert.equal(fs.getDoc('orders', 'ORD-X')?.orderStatus, 'CANCELLED');
  assert.equal((await patch(kitchenUpdate, '/api/admin/kitchen', { date: '2099-01-05', status: 'CANCELLED' }, staff)).status, 400);
  assert.equal((await patch(kitchenUpdate, '/api/admin/kitchen', { date: '2099-01-05', status: 'READY' }, parent)).status, 403);
});

test('teacher orders: only GIVEN/undo, only when paid, never given twice', async () => {
  fs.seed('teacher_orders', 'TCH-1', { id: 'TCH-1', paymentStatus: 'PAID', orderStatus: 'CONFIRMED' });
  fs.seed('teacher_orders', 'TCH-U', { id: 'TCH-U', paymentStatus: 'PENDING', orderStatus: 'CONFIRMED' });
  const url = '/api/staff/teacher-orders';

  for (const orderStatus of ['CANCELLED', 'REFUNDED', 'anything', '']) {
    assert.equal((await patch(teacherOrderUpdate, url, { orderId: 'TCH-1', orderStatus }, staff)).status, 400, orderStatus);
  }
  assert.equal((await patch(teacherOrderUpdate, url, { orderId: 'TCH-U', orderStatus: 'GIVEN' }, staff)).status, 400);
  assert.equal((await patch(teacherOrderUpdate, url, { orderId: 'TCH-1', orderStatus: 'GIVEN' }, staff)).status, 200);
  const givenAt = fs.getDoc('teacher_orders', 'TCH-1')?.collectedAt;
  assert.ok(givenAt);
  assert.equal((await patch(teacherOrderUpdate, url, { orderId: 'TCH-1', orderStatus: 'GIVEN' }, staff)).status, 409);

  assert.equal((await patch(teacherOrderUpdate, url, { orderId: 'TCH-1', orderStatus: 'CONFIRMED' }, staff)).status, 200);
  assert.equal(fs.getDoc('teacher_orders', 'TCH-1')?.orderStatus, 'CONFIRMED');
  assert.equal(fs.getDoc('teacher_orders', 'TCH-1')?.collectedAt, givenAt, 'handover time kept for audit');

  assert.equal((await patch(teacherOrderUpdate, url, { orderId: 'TCH-1', orderStatus: 'GIVEN' }, parent)).status, 403);
  assert.equal((await patch(teacherOrderUpdate, url, { orderId: 'TCH-1', orderStatus: 'GIVEN' }, {})).status, 403);
});

test('payment exceptions and refunds are admin-only', async () => {
  fs.seed('payment_exceptions', 'ORD-E', { id: 'ORD-E', orderId: 'ORD-E', reason: 'AMOUNT_MISMATCH', refundState: 'MANUAL_REVIEW', paidAmount: 80, refundId: 'RFORDE' });
  for (const headers of [staff, parent, {}]) {
    assert.equal((await listExceptions(jsonRequest('/api/admin/payment-exceptions', 'GET', undefined, headers))).status, 403);
    assert.equal((await refundException(jsonRequest('/api/admin/payment-exceptions', 'POST', { orderId: 'ORD-E' }, headers))).status, 403);
  }
  const list = await listExceptions(jsonRequest('/api/admin/payment-exceptions', 'GET', undefined, admin));
  assert.equal(list.status, 200);
  assert.equal(fs.getDoc('payment_exceptions', 'ORD-E')?.refundState, 'MANUAL_REVIEW');
});
