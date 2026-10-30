import './helpers/isolate-env';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeFirestore } from './helpers/fake-firestore';
import { setFirestoreForTesting } from '../lib/firebase-admin';
import { createSessionToken } from '../lib/auth';
import { teacherGuestCookieName, TEACHER_ORDER_ACCESS } from '../lib/teacher-orders';
import { POST as placeOrder } from '../app/api/teacher/orders/route';
import { POST as verifyOrder } from '../app/api/teacher/orders/verify/route';
import { GET as getOrder } from '../app/api/teacher/orders/[id]/route';
import * as staffTeacherOrders from '../app/api/staff/teacher-orders/route';
import * as staffTeacherMenu from '../app/api/staff/teacher-menu/route';
import * as adminOrders from '../app/api/admin/orders/route';
import * as adminKitchen from '../app/api/admin/kitchen/route';

const env = process.env as Record<string, string | undefined>;
const blockedFetch = globalThis.fetch;
let fs: FakeFirestore;
let ip = 0;

/** Cashfree sandbox stub: records requests; the order status is set per test. */
let cashfreeCalls: Array<{ url: string; method: string; body: any }>;
let cashfreeOrder: Record<string, any>;

beforeEach(() => {
  fs = new FakeFirestore();
  fs.seed('teacher_meals', 'TM-001', { id: 'TM-001', name: 'Veg Thali', price: 120, category: 'LUNCH', isAvailable: true, isVegetarian: true });
  fs.seed('teacher_meals', 'TM-002', { id: 'TM-002', name: 'Sandwich', price: 70, category: 'SNACK', isAvailable: false });
  setFirestoreForTesting(fs.asFirestore());

  env.CASHFREE_APP_ID = 'test_app_id';
  env.CASHFREE_SECRET_KEY = 'test_secret_key';
  env.CASHFREE_ENV = 'TEST';
  cashfreeCalls = [];
  cashfreeOrder = { order_status: 'ACTIVE' };
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    cashfreeCalls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    assert.ok(url.startsWith('https://sandbox.cashfree.com/pg/'), `sandbox endpoint only (got ${url})`);
    if (method === 'POST' && url.endsWith('/orders')) {
      return Response.json({ cf_order_id: 'cf_1', payment_session_id: 'session_1', order_amount: 240 });
    }
    if (url.endsWith('/payments')) {
      return Response.json([{ payment_status: 'SUCCESS', payment_amount: cashfreeOrder.order_amount, payment_currency: 'INR', cf_payment_id: 'pay_1' }]);
    }
    return Response.json({ cf_order_id: 'cf_1', ...cashfreeOrder });
  }) as typeof fetch;
});

afterEach(() => {
  setFirestoreForTesting(null);
  globalThis.fetch = blockedFetch;
  delete env.CASHFREE_APP_ID;
  delete env.CASHFREE_SECRET_KEY;
  delete env.CASHFREE_ENV;
});

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.2.0.${++ip}`, ...headers },
    body: JSON.stringify(body),
  });
}

const guestOrder = (overrides: Record<string, unknown> = {}) => ({
  teacherName: '  Asha   Rao ',
  teacherPhone: '+91 98765 43210',
  // Client prices and names are ignored: the server prices from teacher_meals.
  items: [{ mealId: 'TM-001', quantity: 2, price: 1, mealName: 'Free' }],
  ...overrides,
});

async function placeGuestOrder() {
  const res = await placeOrder(post('/api/teacher/orders', guestOrder()));
  assert.equal(res.status, 200);
  const body = await res.json();
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie.startsWith(`${teacherGuestCookieName(body.orderId)}=`), 'guest access cookie is set for this order');
  assert.match(res.headers.get('set-cookie') || '', /HttpOnly/i);
  return { orderId: body.orderId as string, cookie, body };
}

const verify = (orderId: string, headers: Record<string, string> = {}) => verifyOrder(post('/api/teacher/orders/verify', { orderId }, headers));
const fetchOrder = (orderId: string, headers: Record<string, string> = {}) =>
  getOrder(new Request(`http://localhost:3000/api/teacher/orders/${orderId}`, { headers }), { params: Promise.resolve({ id: orderId }) });

test('a guest teacher can start checkout with name and phone; price comes from the server', async () => {
  const { orderId, body } = await placeGuestOrder();

  assert.match(orderId, /^TCH-[A-F0-9]{16}$/);
  assert.equal(body.paymentSessionId, 'session_1');
  assert.equal(body.cashfreeMode, 'sandbox');
  assert.equal(body.totalAmount, 240);

  const sent = cashfreeCalls.find((c) => c.method === 'POST')!.body;
  assert.equal(sent.order_amount, 240);
  assert.equal(sent.order_id, orderId);
  assert.equal(sent.customer_details.customer_phone, '9876543210');
  assert.equal(sent.customer_details.customer_name, 'Asha Rao');

  const pending = fs.getDoc('pending_teacher_orders', orderId)!;
  assert.equal(pending.teacherName, 'Asha Rao');
  assert.equal(pending.teacherPhone, '9876543210');
  assert.equal(pending.userId, null);
  assert.equal(pending.status, 'PENDING_PAYMENT');
  assert.equal(pending.items[0].unitPrice, 120);
  assert.equal(fs.getDoc('teacher_orders', orderId), undefined, 'no order exists before payment is verified');

  const access = fs.getDoc(TEACHER_ORDER_ACCESS, orderId)!;
  assert.match(access.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(pending).includes(access.tokenHash), false, 'token hash is not stored on the order');
});

test('guest checkout input is validated before any payment session is created', async () => {
  const cases: Array<[Record<string, unknown>, number]> = [
    [{ teacherPhone: '' }, 400],
    [{ teacherPhone: '12345' }, 400],
    [{ teacherPhone: '5876543210' }, 400],
    [{ teacherName: 'A' }, 400],
    [{ teacherName: '<script>' }, 400],
    [{ teacherName: 'x'.repeat(81) }, 400],
    [{ notes: 'n'.repeat(301) }, 400],
    [{ items: [] }, 400],
    [{ items: [{ mealId: 'TM-002', quantity: 1 }] }, 400],
    [{ items: [{ mealId: 'TM-404', quantity: 1 }] }, 400],
    [{ items: [{ mealId: 'TM-001', quantity: 51 }] }, 400],
    [{ items: [{ mealId: 'TM-001', quantity: 1.5 }] }, 400],
    [{ items: Array.from({ length: 21 }, () => ({ mealId: 'TM-001', quantity: 1 })) }, 400],
  ];
  for (const [overrides, status] of cases) {
    const res = await placeOrder(post('/api/teacher/orders', guestOrder(overrides)));
    assert.equal(res.status, status, JSON.stringify(overrides).slice(0, 80));
  }
  assert.equal(cashfreeCalls.length, 0);
  assert.deepEqual(fs.list('pending_teacher_orders'), []);
});

test('parents are still sent to the parent portal; signed-in staff keep ownership of their orders', async () => {
  fs.seed('users', 'usr_p', { id: 'usr_p', email: 'p@example.com', name: 'P', role: 'PARENT' });
  fs.seed('users', 'usr_s', { id: 'usr_s', email: 's@example.com', name: 'Staff One', role: 'STAFF', phone: '9123456780' });
  const bearer = async (userId: string, role: any) =>
    ({ authorization: `Bearer ${await createSessionToken({ userId, email: 'x@example.com', name: 'X', role })}` });

  const parent = await placeOrder(post('/api/teacher/orders', guestOrder(), await bearer('usr_p', 'PARENT')));
  assert.equal(parent.status, 403);

  const staff = await placeOrder(post('/api/teacher/orders', guestOrder({ teacherPhone: '' }), await bearer('usr_s', 'STAFF')));
  assert.equal(staff.status, 200);
  const pending = fs.getDoc('pending_teacher_orders', (await staff.json()).orderId)!;
  assert.equal(pending.userId, 'usr_s');
  assert.equal(pending.teacherPhone, '9123456780', 'saved staff phone used when none typed');
});

test('an unpaid guest order is never fulfilled, and the confirmation shows nothing as paid', async () => {
  const { orderId, cookie } = await placeGuestOrder();

  for (const [status, state] of [['ACTIVE', 'PENDING'], ['EXPIRED', 'NOT_PAID'], ['TERMINATED', 'NOT_PAID']]) {
    cashfreeOrder = { order_status: status, order_amount: 240, order_currency: 'INR' };
    const res = await verify(orderId, { cookie });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.verified, false);
    assert.equal(body.state, state, `${status} is reported as ${state}, never as paid`);
    assert.match(body.message, state === 'PENDING' ? /Do not pay again/ : /not completed/);
  }
  assert.equal(fs.getDoc('teacher_orders', orderId), undefined);
  assert.equal((await fetchOrder(orderId, { cookie })).status, 404);
});

test('a paid amount that does not match the server total does not fulfil the order', async () => {
  const { orderId, cookie } = await placeGuestOrder();
  cashfreeOrder = { order_status: 'PAID', order_amount: 1, order_currency: 'INR' };

  const res = await verify(orderId, { cookie });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.state, 'EXCEPTION', 'reported as a received payment needing review, not as unpaid');
  assert.equal(fs.getDoc('teacher_orders', orderId), undefined);
  assert.equal(fs.getDoc('payment_exceptions', orderId)?.reason, 'AMOUNT_MISMATCH');
});

test('a verified payment confirms the guest order; the confirmation page works without a session', async () => {
  const { orderId, cookie } = await placeGuestOrder();
  cashfreeOrder = { order_status: 'PAID', order_amount: 240, order_currency: 'INR' };

  const res = await verify(orderId, { cookie });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).verified, true);

  const order = fs.getDoc('teacher_orders', orderId)!;
  assert.equal(order.paymentStatus, 'PAID');
  assert.equal(order.orderStatus, 'CONFIRMED', 'confirmed, not marked ready for collection');
  assert.equal(order.teacherName, 'Asha Rao');
  assert.equal(order.teacherPhone, '9876543210');
  assert.equal(order.totalAmount, 240);

  const view = await fetchOrder(orderId, { cookie });
  assert.equal(view.status, 200);
  assert.equal((await view.json()).order.teacherName, 'Asha Rao');

  // A repeated verify does not fulfil twice.
  assert.equal((await verify(orderId, { cookie })).status, 200);
  assert.equal(fs.list('teacher_orders').length, 1);
});

test('a guest can only see and verify the order their own cookie was issued for', async () => {
  const first = await placeGuestOrder();
  const second = await placeGuestOrder();
  cashfreeOrder = { order_status: 'PAID', order_amount: 240, order_currency: 'INR' };
  const callsBefore = cashfreeCalls.length;

  // No cookie at all
  assert.equal((await verify(first.orderId)).status, 401);
  assert.equal((await fetchOrder(first.orderId)).status, 401);
  // Another order's token presented under this order's cookie name
  const otherToken = second.cookie.split('=')[1];
  const forged = { cookie: `${teacherGuestCookieName(first.orderId)}=${otherToken}` };
  assert.equal((await verify(first.orderId, forged)).status, 404);
  assert.equal((await fetchOrder(first.orderId, forged)).status, 404);
  // A cookie for a different order
  assert.equal((await verify(first.orderId, { cookie: second.cookie })).status, 401);
  // Malformed IDs are rejected before any lookup
  assert.equal((await verify('../users/usr_1', { cookie: first.cookie })).status, 400);

  assert.equal(cashfreeCalls.length, callsBefore, 'unauthorised callers never trigger gateway calls');
  assert.equal(fs.getDoc('teacher_orders', first.orderId), undefined);
});

test('staff and admin management endpoints still reject unauthenticated callers, guest cookie or not', async () => {
  const { cookie } = await placeGuestOrder();
  const get = (path: string) => new Request(`http://localhost:3000${path}`, { headers: { cookie } });
  const send = (path: string, method: string) =>
    new Request(`http://localhost:3000${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: '{}' });

  const responses = await Promise.all([
    staffTeacherOrders.GET(get('/api/staff/teacher-orders')),
    staffTeacherOrders.PATCH(send('/api/staff/teacher-orders', 'PATCH')),
    staffTeacherMenu.GET(get('/api/staff/teacher-menu')),
    staffTeacherMenu.POST(send('/api/staff/teacher-menu', 'POST')),
    staffTeacherMenu.PUT(send('/api/staff/teacher-menu', 'PUT')),
    staffTeacherMenu.PATCH(send('/api/staff/teacher-menu', 'PATCH')),
    staffTeacherMenu.DELETE(send('/api/staff/teacher-menu?id=TM-001', 'DELETE')),
    adminOrders.GET(get('/api/admin/orders')),
    adminOrders.PATCH(send('/api/admin/orders', 'PATCH')),
    adminKitchen.GET(get('/api/admin/kitchen')),
    adminKitchen.PATCH(send('/api/admin/kitchen', 'PATCH')),
  ]);
  for (const res of responses) {
    assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
  }
  assert.equal(fs.getDoc('teacher_meals', 'TM-001')?.price, 120, 'menu unchanged');
});
