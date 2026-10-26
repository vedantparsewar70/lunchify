import './helpers/isolate-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  getAppBaseUrl,
  getCashfreeMode,
  getVerifiedCashfreePayment,
  isCashfreeConfigured,
  isMockPaymentAllowed,
  paymentDetailsFromCashfree,
  PaymentConfigError,
  verifyCashfreeWebhookSignature,
} from '../lib/cashfree';

const env = process.env as Record<string, string | undefined>;
const KEYS = ['NODE_ENV', 'CASHFREE_ENV', 'CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY', 'NEXT_PUBLIC_APP_URL', 'VERCEL_ENV', 'VERCEL_URL', 'ALLOW_MOCK_PAYMENTS'];
const saved = Object.fromEntries(KEYS.map((k) => [k, env[k]]));
const savedFetch = globalThis.fetch;

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
  globalThis.fetch = savedFetch;
});

test('Cashfree mode must be explicit in production; no silent sandbox fallback', () => {
  env.NODE_ENV = 'production';
  delete env.CASHFREE_ENV;
  assert.throws(() => getCashfreeMode(), PaymentConfigError);
  env.CASHFREE_ENV = 'prod-ish';
  assert.throws(() => getCashfreeMode(), PaymentConfigError);
  env.CASHFREE_ENV = 'PROD';
  assert.equal(getCashfreeMode(), 'production');
  env.CASHFREE_ENV = 'production';
  assert.equal(getCashfreeMode(), 'production');
  env.CASHFREE_ENV = 'sandbox';
  assert.equal(getCashfreeMode(), 'sandbox');

  env.NODE_ENV = 'development';
  delete env.CASHFREE_ENV;
  assert.equal(getCashfreeMode(), 'sandbox');
});

test('return/webhook base URL comes from trusted config, never localhost in production', () => {
  env.NODE_ENV = 'production';
  delete env.NEXT_PUBLIC_APP_URL;
  assert.throws(() => getAppBaseUrl(), PaymentConfigError);
  env.NEXT_PUBLIC_APP_URL = 'http://school-bite.example';
  assert.throws(() => getAppBaseUrl(), PaymentConfigError);
  env.NEXT_PUBLIC_APP_URL = 'not a url';
  assert.throws(() => getAppBaseUrl(), PaymentConfigError);
  env.NEXT_PUBLIC_APP_URL = 'https://school-bite.example/some/path/';
  assert.equal(getAppBaseUrl(), 'https://school-bite.example');

  delete env.NEXT_PUBLIC_APP_URL;
  env.VERCEL_ENV = 'preview';
  env.VERCEL_URL = 'school-bite-preview.vercel.app';
  assert.equal(getAppBaseUrl(), 'https://school-bite-preview.vercel.app');

  delete env.VERCEL_ENV;
  env.NODE_ENV = 'development';
  assert.equal(getAppBaseUrl(), 'http://localhost:3000');
});

test('missing credentials disable Cashfree and mock payments are impossible in production', () => {
  delete env.CASHFREE_APP_ID;
  delete env.CASHFREE_SECRET_KEY;
  assert.equal(isCashfreeConfigured(), false);
  env.CASHFREE_APP_ID = 'test_app_id';
  env.CASHFREE_SECRET_KEY = '   ';
  assert.equal(isCashfreeConfigured(), false);

  env.ALLOW_MOCK_PAYMENTS = 'true';
  env.NODE_ENV = 'production';
  assert.equal(isMockPaymentAllowed(), false);
  env.NODE_ENV = 'development';
  assert.equal(isMockPaymentAllowed(), true);
  delete env.ALLOW_MOCK_PAYMENTS;
  assert.equal(isMockPaymentAllowed(), false);
});

function stubCashfree(orderStatus: string, payments: any[] = []) {
  const urls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    const body = url.endsWith('/payments')
      ? payments
      : { order_id: 'ORD-1', cf_order_id: 555, order_status: orderStatus, order_amount: 120, order_currency: 'INR' };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return urls;
}

test('payment is verified against the Cashfree API, not the client', async () => {
  env.NODE_ENV = 'development';
  env.CASHFREE_ENV = 'TEST';
  env.CASHFREE_APP_ID = 'test_app_id';
  env.CASHFREE_SECRET_KEY = 'test_secret_key';

  const urls = stubCashfree('ACTIVE');
  const unpaid = await getVerifiedCashfreePayment('ORD-1');
  assert.equal(unpaid.paid, false);
  assert.ok(urls.every((u) => u.startsWith('https://sandbox.cashfree.com/pg/')));

  stubCashfree('PAID', [
    { payment_status: 'FAILED', payment_amount: 120 },
    { payment_status: 'SUCCESS', cf_payment_id: 9001, payment_amount: 120, payment_currency: 'INR', payment_method: { upi: { upi_id: 'x@upi' } } },
  ]);
  const paid = await getVerifiedCashfreePayment('ORD-1');
  assert.equal(paid.paid, true);
  const details = paymentDetailsFromCashfree(paid);
  assert.equal(details.amount, 120);
  assert.equal(details.currency, 'INR');
  assert.equal(details.transactionRef, '9001');
  assert.equal(details.paymentMethod, 'UPI');
  assert.equal(details.cashfreeOrderId, '555');
});

test('webhook signatures are verified with HMAC-SHA256 over timestamp + body', () => {
  env.CASHFREE_SECRET_KEY = 'test_webhook_secret';
  const body = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: 'ORD-1' } } });
  const ts = '1761500000000';
  const sig = crypto.createHmac('sha256', 'test_webhook_secret').update(ts + body).digest('base64');

  assert.equal(verifyCashfreeWebhookSignature(body, sig, ts), true);
  assert.equal(verifyCashfreeWebhookSignature(body.replace('ORD-1', 'ORD-2'), sig, ts), false);
  assert.equal(verifyCashfreeWebhookSignature(body, sig, '1761500000001'), false);
  assert.equal(verifyCashfreeWebhookSignature(body, 'short', ts), false);

  delete env.CASHFREE_SECRET_KEY;
  assert.equal(verifyCashfreeWebhookSignature(body, sig, ts), false);
});
