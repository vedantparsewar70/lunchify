import './helpers/isolate-env';
import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeFirestore } from './helpers/fake-firestore';
import { jsonRequest, useFakeFirestore } from './helpers/session';
import { setFirestoreForTesting } from '../lib/firebase-admin';
import { createSessionToken } from '../lib/auth';
import { POST as checkout, GET as listOrders } from '../app/api/parent/orders/route';
import { POST as verify } from '../app/api/parent/orders/verify/route';
import { POST as webhook } from '../app/api/webhooks/cashfree/route';
import { GET as listExceptions, POST as resolveException } from '../app/api/admin/payment-exceptions/route';
import { signedInAs } from './helpers/session';
import crypto from 'crypto';

const env = process.env as Record<string, string | undefined>;
const blockedFetch = globalThis.fetch;
let fs: FakeFirestore;
let parentAuth: Record<string, string>;

/** Cashfree sandbox stub. */
let cf: { status: string; amount: number; paidAt?: string };
let createdOrders: any[];
let refundsCreated: any[];
let refundStatus: string;
let adminAuth: Record<string, string>;
/** Payment attempts Cashfree reports for an unpaid order (null: none). */
let attempts: Array<{ payment_status: string }> | null;

const at = (istLocal: string) => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: new Date(`${istLocal}:00+05:30`) });
};

beforeEach(async () => {
  fs = useFakeFirestore();
  env.CASHFREE_APP_ID = 'test_app_id';
  env.CASHFREE_SECRET_KEY = 'test_secret_key';
  env.CASHFREE_ENV = 'TEST';

  fs.seed('users', 'usr_p1', { id: 'usr_p1', email: 'p1@example.com', name: 'Parent One', role: 'PARENT', phone: '9876543210' });
  fs.seed('parents', 'par_1', { id: 'par_1', userId: 'usr_p1' });
  fs.seed('students', 'stu_1', { id: 'stu_1', parentId: 'par_1', name: 'Riya', grade: '3', studentCategory: 'Primary', isActive: true });
  fs.seed('meals', 'meal_soya', { id: 'meal_soya', name: 'Soyabean Masala+Dal+Chapati+Salad', price: 80, category: 'LUNCH', isVegetarian: true });
  fs.seed('menus', 'menu_2026-11-02_primary', {
    id: 'menu_2026-11-02_primary', date: '2026-11-02', studentCategory: 'Primary', mealId: 'meal_soya',
    isHoliday: false, availableQuantity: 50, maxQuantity: 50, orderingDeadline: '08:30', isActive: true,
  });
  parentAuth = { authorization: `Bearer ${await createSessionToken({ userId: 'usr_p1', email: 'p1@example.com', name: 'P', role: 'PARENT', parentId: 'par_1' })}` };

  cf = { status: 'ACTIVE', amount: 80 };
  createdOrders = [];
  refundsCreated = [];
  refundStatus = 'PENDING';
  attempts = null;
  adminAuth = await signedInAs(fs, 'ADMIN');
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    assert.ok(url.startsWith('https://sandbox.cashfree.com/pg/'), `sandbox only (got ${url})`);
    const path = url.replace('https://sandbox.cashfree.com/pg', '');
    if (method === 'POST' && path === '/orders') {
      const body = JSON.parse(String(init!.body));
      createdOrders.push(body);
      return Response.json({ cf_order_id: `cf_${createdOrders.length}`, order_id: body.order_id, payment_session_id: `sess_${createdOrders.length}`, order_status: 'ACTIVE', order_amount: body.order_amount });
    }
    if (/\/refunds\/[^/]+$/.test(path)) {
      const refundId = path.split('/').pop();
      const hit = refundsCreated.find((r) => r.refund_id === refundId);
      return hit ? Response.json({ ...hit, cf_refund_id: 'cfr_1', refund_status: refundStatus }) : Response.json({ message: 'refund not found' }, { status: 404 });
    }
    if (method === 'POST' && path.endsWith('/refunds')) {
      const body = JSON.parse(String(init!.body));
      refundsCreated.push(body);
      return Response.json({ refund_id: body.refund_id, cf_refund_id: 'cfr_1', refund_status: 'PENDING', refund_amount: body.refund_amount });
    }
    if (path.endsWith('/payments')) {
      if (attempts && cf.status !== 'PAID') return Response.json(attempts);
      return Response.json(cf.status === 'PAID'
        ? [{ payment_status: 'SUCCESS', payment_amount: cf.amount, payment_currency: 'INR', cf_payment_id: 'pay_1', payment_completion_time: cf.paidAt }]
        : []);
    }
    return Response.json({ cf_order_id: 'cf_1', order_status: cf.status, order_amount: cf.amount, order_currency: 'INR' });
  }) as typeof fetch;
});

afterEach(() => {
  mock.timers.reset();
  setFirestoreForTesting(null);
  globalThis.fetch = blockedFetch;
  delete env.CASHFREE_APP_ID;
  delete env.CASHFREE_SECRET_KEY;
  delete env.CASHFREE_ENV;
});

const cart = [{ studentId: 'stu_1', mealId: 'meal_soya', date: '2026-11-02', quantity: 1, mealPrice: 1, studentCategory: 'Primary' }];
const startCheckout = async (key = 'CHK-1') => checkout(jsonRequest('/api/parent/orders', 'POST', { cartItems: cart, paymentMethod: 'UPI', idempotencyKey: key }, parentAuth));
const verifyOrder = async (orderId: string, headers = parentAuth) => (await verify(jsonRequest('/api/parent/orders/verify', 'POST', { orderId }, headers))).json();

test('checkout sends the server price and a payment expiry to Cashfree', async () => {
  at('2026-11-01T10:00');
  const res = await startCheckout();
  assert.equal(res.status, 200);
  const sent = createdOrders[0];
  assert.equal(sent.order_amount, 80, 'client price of 1 ignored');
  const expiresInMin = (Date.parse(sent.order_expiry_time) - Date.now()) / 60000;
  assert.ok(expiresInMin >= 15 && expiresInMin <= 60, `expiry ${expiresInMin} min ahead`);
  assert.match(sent.order_expiry_time, /\+05:30$/);
});

test('pressing Pay again for the same cart reuses the payment; nothing is charged twice', async () => {
  at('2026-11-01T10:00');
  const first = await (await startCheckout()).json();
  const again = await (await startCheckout()).json();
  assert.equal(again.orderId, first.orderId);
  assert.equal(again.paymentSessionId, first.paymentSessionId);
  assert.equal(createdOrders.length, 1, 'one Cashfree order only');

  // The earlier attempt was actually paid: the retry confirms it instead of opening a new payment.
  cf = { status: 'PAID', amount: 80, paidAt: '2026-11-01T10:01:00+05:30' };
  const paidRetry = await (await startCheckout()).json();
  assert.equal(paidRetry.alreadyPaid, true);
  assert.equal(paidRetry.paymentSessionId, undefined);
  assert.equal(createdOrders.length, 1);
  assert.equal(fs.getDoc('orders', first.orderId)?.paymentStatus, 'PAID');
  assert.equal(fs.getDoc('menus', 'menu_2026-11-02_primary')?.availableQuantity, 49, 'stock taken once');
});

test('an expired unpaid attempt asks the browser to start a fresh checkout', async () => {
  at('2026-11-01T10:00');
  await startCheckout();
  cf = { status: 'EXPIRED', amount: 80 };
  const res = await startCheckout();
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'CHECKOUT_EXPIRED');
  const fresh = await startCheckout('CHK-2');
  assert.equal(fresh.status, 200);
  assert.equal(createdOrders.length, 2);
});

test('a retry after the meal was disabled is refused instead of reusing the old payment link', async () => {
  at('2026-11-01T10:00');
  await startCheckout();
  fs.seed('menus', 'menu_2026-11-02_primary', { ...fs.getDoc('menus', 'menu_2026-11-02_primary'), isActive: false });
  const res = await startCheckout();
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /not available/);
});

test('verification reports pending and unpaid truthfully and never creates an order', async () => {
  at('2026-11-01T10:00');
  const { orderId } = await (await startCheckout()).json();
  const pending = await verifyOrder(orderId);
  assert.equal(pending.state, 'PENDING');
  assert.match(pending.message, /Do not pay again/);
  cf = { status: 'EXPIRED', amount: 80 };
  assert.equal((await verifyOrder(orderId)).state, 'NOT_PAID');
  assert.equal(fs.list('orders').length, 0);
});

/** A Cashfree webhook signed with the sandbox test secret, as the gateway would deliver it. */
const deliverWebhook = async (payload: unknown) => {
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = crypto.createHmac('sha256', 'test_secret_key').update(timestamp + body).digest('base64');
  return webhook(new Request('http://localhost:3000/api/webhooks/cashfree', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp },
    body,
  }));
};
const paymentWebhook = (orderId: string) =>
  deliverWebhook({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: orderId }, payment: { payment_status: 'SUCCESS' } } });
const resolve = async (orderId: string, action: 'accept' | 'refund') =>
  resolveException(jsonRequest('/api/admin/payment-exceptions', 'POST', { orderId, action }, adminAuth));
const parentIssues = async () =>
  (await (await listOrders(jsonRequest('/api/parent/orders', 'GET', undefined, parentAuth))).json()).paymentIssues;

/** Checkout at 08:20; the UPI payment completes at 09:04, after the 08:30 cutoff. */
async function latePayment() {
  at('2026-11-02T08:20');
  const { orderId } = await (await startCheckout()).json();
  at('2026-11-02T09:05');
  cf = { status: 'PAID', amount: 80, paidAt: '2026-11-02T09:04:00+05:30' };
  return orderId as string;
}

test('a payment completed after the cutoff goes to admin review: no order, no automatic refund', async () => {
  const orderId = await latePayment();

  const result = await verifyOrder(orderId);
  assert.equal(result.state, 'EXCEPTION');
  assert.equal(result.issueState, 'PENDING_REVIEW');
  assert.match(result.message, /after the ordering deadline/);
  assert.match(result.message, /Please do not pay again/);
  assert.equal(fs.list('orders').length, 0, 'no collectible order');
  const exception = fs.getDoc('payment_exceptions', orderId)!;
  assert.equal(exception.reason, 'PAID_AFTER_CUTOFF');
  assert.equal(exception.refundState, 'MANUAL_REVIEW');
  assert.equal(refundsCreated.length, 0, 'no automatic refund');
  assert.equal(fs.getDoc('menus', 'menu_2026-11-02_primary')?.availableQuantity, 50, 'stock untouched');

  // Webhook redeliveries, repeated verifies and a repeated Pay click change nothing.
  assert.equal((await paymentWebhook(orderId)).status, 200);
  assert.equal((await paymentWebhook(orderId)).status, 200);
  await verifyOrder(orderId);
  const retry = await startCheckout();
  assert.equal(retry.status, 409);
  assert.equal((await retry.json()).code, 'PAYMENT_EXCEPTION');
  assert.equal(refundsCreated.length, 0);
  assert.equal(fs.list('orders').length, 0);
  assert.equal(createdOrders.length, 1, 'no second payment session');
  assert.equal(fs.getDoc('payment_exceptions', orderId)?.refundState, 'MANUAL_REVIEW');

  // Parent and admin see the same state.
  const issues: Array<{ orderId: string; state: string; paidAmount: number }> = await parentIssues();
  assert.deepEqual(issues.map((i) => [i.orderId, i.state, i.paidAmount]), [[orderId, 'PENDING_REVIEW', 80]]);
  const admin = await (await listExceptions(jsonRequest('/api/admin/payment-exceptions', 'GET', undefined, adminAuth))).json();
  assert.equal(admin.exceptions[0].refundState, 'MANUAL_REVIEW');
  assert.equal(admin.exceptions[0].needsAttention, true);
});

test('admin accepts a late payment as an order exactly once; it can no longer be refunded from review', async () => {
  const orderId = await latePayment();
  await verifyOrder(orderId);

  const [first, second] = await Promise.all([resolve(orderId, 'accept'), resolve(orderId, 'accept')]);
  assert.deepEqual([first.status, second.status], [200, 200]);
  assert.equal(fs.list('orders').length, 1);
  assert.equal(fs.list('orderItems').length, 1);
  assert.equal(fs.list('payments').length, 1);
  assert.equal(fs.getDoc('orders', orderId)?.paymentStatus, 'PAID');
  assert.equal(fs.getDoc('orders', orderId)?.acceptedFromReview, true);
  assert.equal(fs.getDoc('menus', 'menu_2026-11-02_primary')?.availableQuantity, 49, 'stock taken once');
  assert.equal(fs.getDoc('payment_exceptions', orderId)?.refundState, 'ORDER_ACCEPTED');

  const refund = await resolve(orderId, 'refund');
  assert.equal((await refund.json()).requested, false);
  await paymentWebhook(orderId);
  assert.equal((await verifyOrder(orderId)).state, 'PAID');
  assert.equal(refundsCreated.length, 0);
  assert.equal(fs.list('orders').length, 1);
  assert.deepEqual(await parentIssues(), [], 'listed as a normal order, not as an issue');
});

test('admin refunds a late payment once; it can then never be accepted, and the refund webhook completes it', async () => {
  const orderId = await latePayment();
  await verifyOrder(orderId);

  const refund = await (await resolve(orderId, 'refund')).json();
  assert.equal(refund.refundState, 'REFUND_PENDING');
  assert.equal(refundsCreated.length, 1);
  assert.equal(refundsCreated[0].refund_amount, 80);
  assert.equal(fs.getDoc('payment_exceptions', orderId)?.resolution, 'REFUNDED_BY_ADMIN');
  assert.equal((await parentIssues())[0].state, 'REFUND_PENDING');

  const accept = await resolve(orderId, 'accept');
  assert.equal(accept.status, 409);
  await resolve(orderId, 'refund'); // a second click looks the refund up instead of creating another
  await paymentWebhook(orderId);
  assert.equal(refundsCreated.length, 1, 'one refund');
  assert.equal(fs.list('orders').length, 0);

  refundStatus = 'SUCCESS';
  const refundId = fs.getDoc('payment_exceptions', orderId)?.refundId;
  await deliverWebhook({ type: 'REFUND_STATUS_WEBHOOK', data: { refund: { order_id: orderId, refund_id: refundId } } });
  assert.equal(fs.getDoc('payment_exceptions', orderId)?.refundState, 'REFUNDED');
  assert.equal((await parentIssues())[0].state, 'REFUNDED');
  assert.match((await verifyOrder(orderId)).message, /has been refunded/);
});

test('accepting and refunding at the same moment: exactly one wins', async () => {
  const orderId = await latePayment();
  await verifyOrder(orderId);
  await Promise.all([resolve(orderId, 'accept'), resolve(orderId, 'refund')]);
  const accepted = fs.list('orders').length === 1;
  assert.equal(refundsCreated.length, accepted ? 0 : 1, 'never both an order and a refund');
  assert.equal(fs.getDoc('payment_exceptions', orderId)?.refundState, accepted ? 'ORDER_ACCEPTED' : 'REFUND_PENDING');
});

test('accepting is refused for staff, and when the meal sold out meanwhile', async () => {
  const orderId = await latePayment();
  await verifyOrder(orderId);
  const staffAuth = await signedInAs(fs, 'STAFF');
  const byStaff = await resolveException(jsonRequest('/api/admin/payment-exceptions', 'POST', { orderId, action: 'accept' }, staffAuth));
  assert.equal(byStaff.status, 403);

  fs.seed('menus', 'menu_2026-11-02_primary', { ...fs.getDoc('menus', 'menu_2026-11-02_primary'), availableQuantity: 0 });
  const res = await resolve(orderId, 'accept');
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /refund it instead/);
  assert.equal(fs.list('orders').length, 0);
  assert.equal(fs.getDoc('payment_exceptions', orderId)?.refundState, 'MANUAL_REVIEW');
});

test('a payment made before the deadline is honoured even if confirmation arrives later', async () => {
  at('2026-11-02T08:20');
  const { orderId } = await (await startCheckout()).json();
  at('2026-11-02T09:30');
  cf = { status: 'PAID', amount: 80, paidAt: '2026-11-02T08:25:00+05:30' };
  const result = await verifyOrder(orderId);
  assert.equal(result.state, 'PAID');
  assert.equal(fs.getDoc('orders', orderId)?.orderStatus, 'CONFIRMED');
});

test('a menu disabled (or turned into a holiday) after checkout makes the payment an exception', async () => {
  at('2026-11-01T10:00');
  const { orderId } = await (await startCheckout()).json();
  fs.seed('menus', 'menu_2026-11-02_primary', { ...fs.getDoc('menus', 'menu_2026-11-02_primary'), isHoliday: true });
  cf = { status: 'PAID', amount: 80, paidAt: '2026-11-01T10:02:00+05:30' };
  const result = await verifyOrder(orderId);
  assert.equal(result.state, 'EXCEPTION');
  assert.equal(result.issueState, 'PENDING_REVIEW');
  assert.equal(fs.getDoc('payment_exceptions', orderId)?.reason, 'SERVICE_UNAVAILABLE');
  assert.equal(fs.list('orders').length, 0);
  assert.equal(refundsCreated.length, 0, 'no automatic refund; an admin decides');
});

test("a parent cannot verify or view another parent's order", async () => {
  at('2026-11-01T10:00');
  const { orderId } = await (await startCheckout()).json();
  fs.seed('users', 'usr_p2', { id: 'usr_p2', email: 'p2@example.com', name: 'P2', role: 'PARENT' });
  fs.seed('parents', 'par_2', { id: 'par_2', userId: 'usr_p2' });
  const other = { authorization: `Bearer ${await createSessionToken({ userId: 'usr_p2', email: 'p2@example.com', name: 'P2', role: 'PARENT' })}` };
  const res = await verify(jsonRequest('/api/parent/orders/verify', 'POST', { orderId }, other));
  assert.equal(res.status, 404);

  cf = { status: 'PAID', amount: 80, paidAt: '2026-11-01T10:02:00+05:30' };
  await verifyOrder(orderId);
  const theirs = await (await listOrders(jsonRequest(`/api/parent/orders?id=${orderId}`, 'GET', undefined, other))).json();
  assert.deepEqual(theirs.orders, []);
});

test('cancelled orders stay visible to the parent with their refund state', async () => {
  fs.seed('orders', 'ORD-C', { id: 'ORD-C', parentId: 'par_1', totalAmount: 80, paymentStatus: 'REFUND_PENDING', orderStatus: 'CANCELLED' });
  fs.seed('orders', 'ORD-U', { id: 'ORD-U', parentId: 'par_1', totalAmount: 80, paymentStatus: 'PENDING', orderStatus: 'CONFIRMED' });
  const body = await (await listOrders(jsonRequest('/api/parent/orders', 'GET', undefined, parentAuth))).json();
  const ids = body.orders.map((o: any) => o.id);
  assert.ok(ids.includes('ORD-C'));
  assert.ok(!ids.includes('ORD-U'), 'unpaid attempts are not listed as orders');
});

test('a second tab or device paying for the same cart reopens the same payment, never a second one', async () => {
  at('2026-11-01T10:00');
  const first = await (await startCheckout('CHK-TAB1')).json();
  const second = await (await startCheckout('CHK-TAB2')).json();
  assert.equal(second.orderId, first.orderId);
  assert.equal(second.paymentSessionId, first.paymentSessionId);
  assert.equal(createdOrders.length, 1);

  // A different cart is a different order.
  const bigger = [{ ...cart[0], quantity: 2 }];
  const other = await checkout(jsonRequest('/api/parent/orders', 'POST', { cartItems: bigger, paymentMethod: 'UPI', idempotencyKey: 'CHK-TAB3' }, parentAuth));
  assert.equal(other.status, 200);
  assert.equal(createdOrders.length, 2);
});

test('a failed payment attempt is reported as not paid, and paying again reopens the same Cashfree order', async () => {
  at('2026-11-01T10:00');
  const { orderId, paymentSessionId } = await (await startCheckout()).json();

  attempts = [{ payment_status: 'PENDING' }];
  assert.equal((await verifyOrder(orderId)).state, 'PENDING', 'a UPI payment still in progress is not called failed');

  attempts = [{ payment_status: 'FAILED' }, { payment_status: 'USER_DROPPED' }];
  const failed = await verifyOrder(orderId);
  assert.equal(failed.state, 'NOT_PAID');
  assert.equal(failed.retryable, true);
  assert.equal(fs.list('orders').length, 0, 'no order without payment');

  const retry = await (await startCheckout()).json();
  assert.equal(retry.paymentSessionId, paymentSessionId);
  assert.equal(createdOrders.length, 1, 'still one Cashfree order, which can only be paid once');
});

test("checkout uses the same class-to-menu rule as the menu the parent saw", async () => {
  at('2026-11-01T10:00');
  // No stored category: "Class 3" is Primary on the menu page, so checkout must agree.
  fs.seed('students', 'stu_2', { id: 'stu_2', parentId: 'par_1', name: 'Aarav', grade: 'Class 3', isActive: true });
  const res = await checkout(jsonRequest('/api/parent/orders', 'POST', {
    cartItems: [{ ...cart[0], studentId: 'stu_2', studentCategory: 'Secondary' }], paymentMethod: 'UPI', idempotencyKey: 'CHK-CAT',
  }, parentAuth));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
});
