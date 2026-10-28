import './helpers/isolate-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakeFirestore } from './helpers/fake-firestore';
import { CashfreeApiError, createCashfreeRefund, getCashfreeRefund, refundIdempotencyKey } from '../lib/cashfree';
import { refundIdForOrder, RefundClient } from '../lib/order-cancellation';
import { needsAttention, refundPaymentException, REFUND_ATTEMPT_LEASE_MS } from '../lib/payment-exceptions';

const env = process.env as Record<string, string | undefined>;
const savedFetch = globalThis.fetch;
afterEach(() => {
  delete env.CASHFREE_APP_ID;
  delete env.CASHFREE_SECRET_KEY;
  delete env.CASHFREE_ENV;
  globalThis.fetch = savedFetch;
});

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function seedException(fs: FakeFirestore, overrides: Record<string, any> = {}) {
  fs.seed('payment_exceptions', 'ORD-R', {
    id: 'ORD-R', orderId: 'ORD-R', reason: 'STOCK_UNAVAILABLE', paidAmount: 120, cashfreeOrderId: 'cf_1',
    refundId: refundIdForOrder('ORD-R'), refundState: 'NOT_REQUESTED', createdAt: ago(1000), ...overrides,
  });
}

/** Scripted gateway: each call pops the next outcome; a refund "exists" once a create succeeded. */
function gateway(createOutcomes: Array<string | Error>, getOutcomes: Array<string | Error> = []) {
  const calls = { create: 0, get: 0 };
  const client: RefundClient = {
    async create(p) {
      calls.create++;
      const o = createOutcomes.shift() ?? new CashfreeApiError('unexpected', 400, false);
      if (o instanceof Error) throw o;
      return { refundId: p.refundId, cfRefundId: 'cf_rf', status: o, amount: p.amount };
    },
    async get(_orderId, refundId) {
      calls.get++;
      const o = getOutcomes.shift() ?? new CashfreeApiError('refund not found', 404, false);
      if (o instanceof Error) throw o;
      return { refundId, cfRefundId: 'cf_rf', status: o, amount: 120 };
    },
  };
  return { client, calls };
}

test('refund IDs are stable, alphanumeric and within Cashfree limits', () => {
  const id = refundIdForOrder('ORD-ABC');
  assert.equal(id, refundIdForOrder('ORD-ABC'));
  assert.notEqual(id, refundIdForOrder('ORD-ABD'));
  assert.match(id, /^[A-Za-z0-9]{3,40}$/);
});

test('a timed-out refund is recorded as unknown, not failed, and is never created twice', async () => {
  const fs = new FakeFirestore();
  seedException(fs);
  const db = fs.asFirestore();
  // First attempt: lookup says not found, create times out (it actually went through).
  const { client, calls } = gateway([new CashfreeApiError('timed out', null, true)], [new CashfreeApiError('not found', 404, false), 'SUCCESS']);

  const first = await refundPaymentException('ORD-R', {}, db, client);
  assert.equal(first.refundState, 'REFUND_PENDING');
  assert.equal(fs.getDoc('payment_exceptions', 'ORD-R')?.gatewayRefundStatus, 'UNKNOWN');

  // A webhook retry inside the lease does nothing.
  assert.equal((await refundPaymentException('ORD-R', {}, db, client)).requested, false);

  // After the lease, the retry looks the refund up first and finds it.
  fs.seed('payment_exceptions', 'ORD-R', { ...fs.getDoc('payment_exceptions', 'ORD-R'), refundRequestedAt: ago(REFUND_ATTEMPT_LEASE_MS + 1000) });
  const recovered = await refundPaymentException('ORD-R', {}, db, client);
  assert.equal(recovered.refundState, 'REFUNDED');
  assert.equal(calls.create, 1, 'no second create');
});

test('a crash after claiming the refund is recovered by the next webhook retry', async () => {
  const fs = new FakeFirestore();
  // State left behind when the process died between claiming and calling Cashfree.
  seedException(fs, { refundState: 'REFUND_PENDING', gatewayRefundStatus: 'REQUESTED', refundRequestedAt: ago(REFUND_ATTEMPT_LEASE_MS + 1000) });
  const { client, calls } = gateway(['PENDING']);

  assert.equal(needsAttention(fs.getDoc('payment_exceptions', 'ORD-R')!, Date.now()), false, 'within 15 minutes');
  const result = await refundPaymentException('ORD-R', {}, fs.asFirestore(), client);
  assert.equal(result.requested, true);
  assert.equal(result.refundState, 'REFUND_PENDING');
  assert.equal(calls.get, 1, 'looked up before creating');
  assert.equal(calls.create, 1);
});

test('an ambiguous lookup never leads to a create', async () => {
  const fs = new FakeFirestore();
  seedException(fs);
  const { client, calls } = gateway(['SUCCESS'], [new CashfreeApiError('HTTP 503', 503, true)]);
  const result = await refundPaymentException('ORD-R', {}, fs.asFirestore(), client);
  assert.equal(result.refundState, 'REFUND_PENDING');
  assert.equal(calls.create, 0);
});

test('a duplicate rejection from a concurrent attempt resolves to the existing refund', async () => {
  const fs = new FakeFirestore();
  seedException(fs);
  const { client } = gateway([new CashfreeApiError('refund_id already exists', 409, false)], [new CashfreeApiError('not found', 404, false), 'PENDING']);
  const result = await refundPaymentException('ORD-R', {}, fs.asFirestore(), client);
  assert.equal(result.refundState, 'REFUND_PENDING');
});

test('rejected and cancelled refunds are failures; pending approval is in progress', async () => {
  for (const [status, expected] of [['REJECTED', 'REFUND_FAILED'], ['CANCELLED', 'REFUND_FAILED'], ['PENDING_APPROVAL', 'REFUND_PENDING']]) {
    const fs = new FakeFirestore();
    seedException(fs);
    const result = await refundPaymentException('ORD-R', {}, fs.asFirestore(), gateway([status]).client);
    assert.equal(result.refundState, expected, status);
  }
});

test('needsAttention flags failed, manual-review and stalled exceptions', () => {
  const now = Date.now();
  assert.equal(needsAttention({ refundState: 'REFUND_FAILED' }, now), true);
  assert.equal(needsAttention({ refundState: 'MANUAL_REVIEW' }, now), true);
  assert.equal(needsAttention({ refundState: 'NOT_REQUESTED', createdAt: ago(20 * 60 * 1000) }, now), true);
  assert.equal(needsAttention({ refundState: 'REFUND_PENDING', gatewayRefundStatus: 'UNKNOWN', refundRequestedAt: ago(20 * 60 * 1000) }, now), true);
  assert.equal(needsAttention({ refundState: 'REFUND_PENDING', gatewayRefundStatus: 'PENDING', refundRequestedAt: ago(20 * 60 * 1000) }, now), false);
  assert.equal(needsAttention({ refundState: 'REFUNDED' }, now), false);
});

test('refund API calls use a fixed idempotency key and classify failures', async () => {
  env.CASHFREE_APP_ID = 'test_app_id';
  env.CASHFREE_SECRET_KEY = 'test_secret_key';
  env.CASHFREE_ENV = 'TEST';
  const sent: Array<{ url: string; key: string | null; body: string }> = [];
  let mode: 'ok' | 'network' | '409' | '500' = 'ok';
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    sent.push({ url: String(input), key: headers.get('x-idempotency-key'), body: String(init?.body ?? '') });
    if (mode === 'network') throw new TypeError('fetch failed');
    const status = mode === 'ok' ? 200 : Number(mode);
    return new Response(JSON.stringify({ refund_id: 'RFx', refund_status: 'PENDING', refund_amount: 120, message: 'err' }), { status });
  }) as typeof fetch;

  const params = { orderId: 'ORD-1', refundId: refundIdForOrder('ORD-1'), amount: 120 };
  await createCashfreeRefund(params);
  await createCashfreeRefund(params);
  assert.ok(sent[0].url.startsWith('https://sandbox.cashfree.com/pg/orders/ORD-1/refunds'));
  assert.equal(sent[0].key, refundIdempotencyKey(params.refundId));
  assert.match(sent[0].key!, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(sent[0].key, sent[1].key);
  assert.equal(sent[0].body, sent[1].body, 'identical body on retry');

  for (const [m, ambiguous] of [['network', true], ['500', true], ['409', false]] as const) {
    mode = m;
    await assert.rejects(createCashfreeRefund(params), (e: unknown) => e instanceof CashfreeApiError && e.ambiguous === ambiguous);
    await assert.rejects(getCashfreeRefund('ORD-1', params.refundId), (e: unknown) => e instanceof CashfreeApiError && e.ambiguous === ambiguous);
  }
});

test('the reconciliation script only reads', () => {
  const source = readFileSync(join(__dirname, '..', 'scripts', 'reconcile-refunds.ts'), 'utf8');
  // No document references at all, so nothing can be written to; collection queries use .get() only.
  for (const write of ['.doc(', '.update(', '.delete(', '.create(', '.add(', 'batch(', 'runTransaction(', 'createCashfreeRefund', 'method:']) {
    assert.equal(source.includes(write), false, `found ${write}`);
  }
  // The only .set( is the in-memory Map of category counts.
  assert.equal(source.split('.set(').length - 1, source.split('counts.set(').length - 1);
  assert.ok(source.includes('getCashfreeOrderRefunds'));
});

test('only a 404 lookup allows a create; auth, validation and rate-limit errors never do', async () => {
  for (const [lookupErr, expectedStatus] of [
    [new CashfreeApiError('authentication Failed', 401, false), 'LOOKUP_FAILED'],
    [new CashfreeApiError('bad URL', 400, false), 'LOOKUP_FAILED'],
    [new CashfreeApiError('Too many requests', 429, true), 'UNKNOWN'],
    [new CashfreeApiError('internal Server Error', 500, true), 'UNKNOWN'],
    [new Error('unexpected failure'), 'LOOKUP_FAILED'],
  ] as const) {
    const fs = new FakeFirestore();
    seedException(fs);
    const { client, calls } = gateway(['SUCCESS'], [lookupErr]);
    const result = await refundPaymentException('ORD-R', {}, fs.asFirestore(), client);
    assert.equal(result.refundState, 'REFUND_PENDING', lookupErr.message);
    assert.equal(fs.getDoc('payment_exceptions', 'ORD-R')?.gatewayRefundStatus, expectedStatus);
    assert.equal(calls.create, 0, `no create after: ${lookupErr.message}`);
  }
});

test('a rejected create is only "failed" once a lookup confirms nothing was created', async () => {
  // 401 on create, recheck confirms absent (404): definitely failed, admin can retry.
  let fs = new FakeFirestore();
  seedException(fs);
  let result = await refundPaymentException('ORD-R', {}, fs.asFirestore(),
    gateway([new CashfreeApiError('authentication Failed', 401, false)]).client);
  assert.equal(result.refundState, 'REFUND_FAILED');

  // 422 on create, recheck itself fails with 401: unknown, stays pending, never "failed".
  fs = new FakeFirestore();
  seedException(fs);
  result = await refundPaymentException('ORD-R', {}, fs.asFirestore(),
    gateway([new CashfreeApiError('idempotency', 422, false)], [new CashfreeApiError('not found', 404, false), new CashfreeApiError('auth', 401, false)]).client);
  assert.equal(result.refundState, 'REFUND_PENDING');

  // 429 on create: may be retried; nothing assumed.
  fs = new FakeFirestore();
  seedException(fs);
  result = await refundPaymentException('ORD-R', {}, fs.asFirestore(),
    gateway([new CashfreeApiError('Too many requests', 429, true)]).client);
  assert.equal(result.refundState, 'REFUND_PENDING');
  assert.equal(fs.getDoc('payment_exceptions', 'ORD-R')?.gatewayRefundStatus, 'UNKNOWN');
});

test('an unresolved lookup is retried after the lease and then completes', async () => {
  const fs = new FakeFirestore();
  seedException(fs, { refundState: 'REFUND_PENDING', gatewayRefundStatus: 'LOOKUP_FAILED', refundRequestedAt: ago(REFUND_ATTEMPT_LEASE_MS + 1000) });
  const { client, calls } = gateway(['SUCCESS']);
  const result = await refundPaymentException('ORD-R', {}, fs.asFirestore(), client);
  assert.equal(result.refundState, 'REFUNDED');
  assert.equal(calls.create, 1);
});

test('HTTP responses map to Cashfree error classes', async () => {
  env.CASHFREE_APP_ID = 'test_app_id';
  env.CASHFREE_SECRET_KEY = 'test_secret_key';
  env.CASHFREE_ENV = 'TEST';
  for (const [status, ambiguous, notFound] of [[404, false, true], [401, false, false], [400, false, false], [429, true, false], [502, true, false]] as const) {
    globalThis.fetch = (async () => new Response('{"message":"x"}', { status })) as typeof fetch;
    await assert.rejects(getCashfreeRefund('ORD-1', 'RF1'), (e: unknown) =>
      e instanceof CashfreeApiError && e.ambiguous === ambiguous && e.notFound === notFound && e.status === status);
  }
});
