import './helpers/isolate-env';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeFirestore } from './helpers/fake-firestore';
import { jsonRequest, signedInAs, useFakeFirestore } from './helpers/session';
import { setFirestoreForTesting } from '../lib/firebase-admin';
import { CashfreeApiError } from '../lib/cashfree';
import { cancelOrderWithRefund, RefundClient } from '../lib/order-cancellation';
import { GET as listAdminOrders, PATCH as updateOrder } from '../app/api/admin/orders/route';
import { GET as kitchenSummary, PATCH as kitchenUpdate } from '../app/api/admin/kitchen/route';
import { GET as listParentOrders, PATCH as cancelOwnOrder } from '../app/api/parent/orders/route';

const MON = '2099-01-05';
const TUE = '2099-01-06';

let fs: FakeFirestore;
let staff: Record<string, string>;
let admin: Record<string, string>;
let parent: Record<string, string>;

/** One payment covering two service dates (₹80 each). */
function seedMultiDateOrder(id = 'ORD-M', fields: Record<string, unknown> = {}) {
  fs.seed('orders', id, { id, parentId: 'par_usr_parent', totalAmount: 160, paymentStatus: 'PAID', orderStatus: 'CONFIRMED', cashfreeOrderId: 'cf_m', ...fields });
  for (const date of [MON, TUE]) {
    const menuId = `menu_${date}_primary`;
    fs.seed('menus', menuId, { id: menuId, mealId: 'meal_soya', date, studentCategory: 'Primary', availableQuantity: 10 });
    fs.seed('orderItems', `oit_${id}_${date}`, {
      id: `oit_${id}_${date}`, orderId: id, studentId: 'stu_1', mealId: 'meal_soya', menuId, date, quantity: 1, unitPrice: 80, totalPrice: 80, studentCategory: 'Primary',
    });
  }
}

beforeEach(async () => {
  fs = useFakeFirestore();
  staff = await signedInAs(fs, 'STAFF');
  admin = await signedInAs(fs, 'ADMIN');
  parent = await signedInAs(fs, 'PARENT');
  fs.seed('students', 'stu_1', { id: 'stu_1', parentId: 'par_usr_parent', name: 'Riya', grade: '3', division: 'A', rollNo: '7', isActive: true });
  fs.seed('meals', 'meal_soya', { id: 'meal_soya', name: 'Soyabean Masala', price: 80, category: 'LUNCH', isVegetarian: true });
});

afterEach(() => setFirestoreForTesting(null));

const patch = (handler: (req: Request) => Promise<Response>, url: string, body: unknown, headers: Record<string, string>) =>
  handler(jsonRequest(url, 'PATCH', body, headers));
const give = (date: string | undefined, who = staff) =>
  patch(updateOrder, '/api/admin/orders', { orderId: 'ORD-M', orderStatus: 'COLLECTED', date }, who);
const staffView = async (date: string) =>
  (await (await listAdminOrders(jsonRequest(`/api/admin/orders?date=${date}`, 'GET', undefined, staff))).json()).orders;
const dateState = (date: string) => fs.getDoc('orders', 'ORD-M')?.serviceDates?.[date];

test("giving Monday's meal does not mark Tuesday's as given", async () => {
  seedMultiDateOrder();

  assert.equal((await give(MON)).status, 200);
  assert.equal(dateState(MON)?.status, 'COLLECTED');
  assert.ok(dateState(MON)?.collectedAt);
  assert.equal(dateState(TUE)?.status, 'CONFIRMED');
  assert.equal(fs.getDoc('orders', 'ORD-M')?.orderStatus, 'CONFIRMED', 'the order is not fully collected');
  assert.equal(fs.getDoc('orders', 'ORD-M')?.paymentStatus, 'PAID');
  assert.equal(fs.getDoc('orders', 'ORD-M')?.totalAmount, 160, 'payment record untouched');

  // Staff screens: given on Monday's list, still to hand over on Tuesday's.
  assert.equal((await staffView(MON))[0].serviceStatus, 'COLLECTED');
  assert.equal((await staffView(TUE))[0].serviceStatus, 'CONFIRMED');

  assert.equal((await give(MON)).status, 409, 'no double handover for the same day');
  assert.equal((await give(undefined)).status, 400, 'a multi-day order must name the day');
  assert.equal(dateState(TUE)?.status, 'CONFIRMED');

  assert.equal((await give(TUE)).status, 200);
  assert.equal(fs.getDoc('orders', 'ORD-M')?.orderStatus, 'COLLECTED', 'collected once every day is given');
});

test("undoing one day's handover leaves the other day given and keeps the audit trail", async () => {
  seedMultiDateOrder();
  await give(MON);
  await give(TUE);
  const givenAt = dateState(MON)?.collectedAt;

  const undo = await patch(updateOrder, '/api/admin/orders', { orderId: 'ORD-M', orderStatus: 'CONFIRMED', date: MON }, staff);
  assert.equal(undo.status, 200);
  assert.equal(dateState(MON)?.status, 'CONFIRMED');
  assert.equal(dateState(MON)?.collectedAt, givenAt);
  assert.ok(dateState(MON)?.revertedAt);
  assert.equal(dateState(TUE)?.status, 'COLLECTED');
  assert.equal(fs.getDoc('orders', 'ORD-M')?.orderStatus, 'CONFIRMED');
});

test('kitchen bulk handover for a date changes only that date', async () => {
  seedMultiDateOrder();
  const res = await patch(kitchenUpdate, '/api/admin/kitchen', { date: MON, status: 'COLLECTED' }, staff);
  assert.equal(res.status, 200);
  assert.equal(dateState(MON)?.status, 'COLLECTED');
  assert.equal(dateState(TUE)?.status ?? 'CONFIRMED', 'CONFIRMED');

  // By order ID without a date, a multi-day order is skipped rather than given for every day.
  const byId = await (await patch(kitchenUpdate, '/api/admin/kitchen', { orderIds: ['ORD-M'], status: 'READY' }, staff)).json();
  assert.equal(byId.skipped, 1);
  assert.equal(dateState(TUE)?.status, 'CONFIRMED');

  const kitchen = await (await kitchenSummary(jsonRequest(`/api/admin/kitchen?date=${TUE}&refresh=true`, 'GET', undefined, staff))).json();
  assert.equal(kitchen.studentList[0].orderStatus, 'CONFIRMED');
});

test('cancelling a single day is refused and changes nothing; no refund is started', async () => {
  seedMultiDateOrder();
  const byParent = await patch(cancelOwnOrder, '/api/parent/orders', { orderId: 'ORD-M', date: TUE }, parent);
  assert.equal(byParent.status, 409);
  assert.match((await byParent.json()).error, /partial refunds are not supported/);
  const byAdmin = await patch(updateOrder, '/api/admin/orders', { orderId: 'ORD-M', orderStatus: 'CANCELLED', date: TUE }, admin);
  assert.equal(byAdmin.status, 409);

  const order = fs.getDoc('orders', 'ORD-M')!;
  assert.equal(order.orderStatus, 'CONFIRMED');
  assert.equal(order.paymentStatus, 'PAID');
  assert.equal(order.refundId, undefined);
  assert.equal(fs.getDoc('menus', `menu_${TUE}_primary`)?.availableQuantity, 10, 'stock untouched');
});

test('once one day was handed over, the whole order cannot be cancelled and refunded, even by an admin', async () => {
  seedMultiDateOrder();
  await give(MON);
  await patch(updateOrder, '/api/admin/orders', { orderId: 'ORD-M', orderStatus: 'CONFIRMED', date: MON }, staff);

  const byAdmin = await patch(updateOrder, '/api/admin/orders', { orderId: 'ORD-M', orderStatus: 'CANCELLED' }, admin);
  assert.equal(byAdmin.status, 409);
  assert.match((await byAdmin.json()).error, /already handed over/);
  const byStaff = await patch(updateOrder, '/api/admin/orders', { orderId: 'ORD-M', orderStatus: 'CANCELLED' }, staff);
  assert.equal(byStaff.status, 403);
  assert.equal(fs.getDoc('orders', 'ORD-M')?.paymentStatus, 'PAID');
});

test('a multi-day order cancelled before anything was served is refunded in full exactly once', async () => {
  seedMultiDateOrder();
  const calls: unknown[] = [];
  const client: RefundClient = {
    async create(params) {
      calls.push(params);
      return { refundId: params.refundId, cfRefundId: 'cfr', status: 'SUCCESS', amount: params.amount };
    },
    async get() {
      throw new CashfreeApiError('refund not found', 404, false);
    },
  };
  const db = fs.asFirestore();
  const first = await cancelOrderWithRefund({ orderId: 'ORD-M', cancelledBy: 'usr_admin' }, db, client);
  const again = await cancelOrderWithRefund({ orderId: 'ORD-M', cancelledBy: 'usr_admin' }, db, client);
  assert.equal(first.paymentStatus, 'REFUNDED');
  assert.equal(first.refundAmount, 160);
  assert.equal(again.alreadyCancelled, true);
  assert.equal(calls.length, 1);
  assert.equal(fs.getDoc('menus', `menu_${MON}_primary`)?.availableQuantity, 11);
  assert.equal(fs.getDoc('menus', `menu_${TUE}_primary`)?.availableQuantity, 11);
});

test('orders saved before per-day tracking keep their meaning: a collected order stays collected on every day', async () => {
  seedMultiDateOrder('ORD-M', { orderStatus: 'COLLECTED', collectedAt: '2099-01-05T03:00:00Z' });
  assert.equal((await staffView(MON))[0].serviceStatus, 'COLLECTED');
  assert.equal((await staffView(TUE))[0].serviceStatus, 'COLLECTED');

  await patch(updateOrder, '/api/admin/orders', { orderId: 'ORD-M', orderStatus: 'CONFIRMED', date: MON }, staff);
  assert.equal(dateState(MON)?.status, 'CONFIRMED');
  assert.equal(dateState(TUE)?.status, 'COLLECTED', 'the other day is not silently un-given');
});

test('single-date orders still work without naming the date, and the parent sees each day', async () => {
  fs.seed('orders', 'ORD-S', { id: 'ORD-S', parentId: 'par_usr_parent', totalAmount: 80, paymentStatus: 'PAID', orderStatus: 'CONFIRMED' });
  fs.seed('orderItems', 'oit_s', { id: 'oit_s', orderId: 'ORD-S', studentId: 'stu_1', mealId: 'meal_soya', date: MON, quantity: 1 });
  const res = await patch(updateOrder, '/api/admin/orders', { orderId: 'ORD-S', orderStatus: 'COLLECTED' }, staff);
  assert.equal(res.status, 200);
  assert.equal(fs.getDoc('orders', 'ORD-S')?.orderStatus, 'COLLECTED');

  seedMultiDateOrder();
  await give(MON);
  const body = await (await listParentOrders(jsonRequest('/api/parent/orders', 'GET', undefined, parent))).json();
  type Listed = { id: string; items: Array<{ date: string; serviceStatus: string }> };
  const orders: Listed[] = body.orders;
  const multi = orders.find((o) => o.id === 'ORD-M')!;
  const byDate = Object.fromEntries(multi.items.map((it) => [it.date, it.serviceStatus]));
  assert.deepEqual(byDate, { [MON]: 'COLLECTED', [TUE]: 'CONFIRMED' });
  assert.equal(orders.find((o) => o.id === 'ORD-S')!.items[0].serviceStatus, 'COLLECTED');
});
