import './helpers/isolate-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeFirestore } from './helpers/fake-firestore';
import { normalizeIndianMobile, resolveCheckoutPhone } from '../lib/phone';
import { updateOwnPhone } from '../lib/profile';
import { createCashfreeOrder } from '../lib/cashfree';

const env = process.env as Record<string, string | undefined>;
const savedFetch = globalThis.fetch;
afterEach(() => {
  delete env.CASHFREE_APP_ID;
  delete env.CASHFREE_SECRET_KEY;
  globalThis.fetch = savedFetch;
});

test('Indian mobile numbers are normalised; anything else is rejected', () => {
  for (const [input, expected] of [
    ['9876543210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    ['91-9876543210', '9876543210'],
    ['09876543210', '9876543210'],
    ['(987) 654-3210', '9876543210'],
  ]) {
    assert.equal(normalizeIndianMobile(input), expected, input);
  }
  for (const input of ['', '12345', '5876543210', '98765432101', '+1 202 555 0100', '98765abc10', null, undefined, {}]) {
    assert.equal(normalizeIndianMobile(input), null, String(input));
  }
});

function seedUsers() {
  const fs = new FakeFirestore();
  fs.seed('users', 'usr_p1', { id: 'usr_p1', role: 'PARENT', phone: null });
  fs.seed('users', 'usr_p2', { id: 'usr_p2', role: 'PARENT', phone: '9123456780' });
  return fs;
}

test('a parent can update only their own phone, with a valid number', async () => {
  const fs = seedUsers();
  const db = fs.asFirestore();

  const ok = await updateOwnPhone({ id: 'usr_p1', role: 'PARENT' }, '+91 98765 43210', db);
  assert.deepEqual(ok, { ok: true, phone: '9876543210' });
  assert.equal(fs.getDoc('users', 'usr_p1')?.phone, '9876543210');
  assert.equal(fs.getDoc('users', 'usr_p2')?.phone, '9123456780', 'other parents untouched');

  const bad = await updateOwnPhone({ id: 'usr_p1', role: 'PARENT' }, '12345', db);
  assert.equal(bad.ok, false);
  assert.equal(fs.getDoc('users', 'usr_p1')?.phone, '9876543210');
});

test('signed-out users, staff and admins cannot use the parent phone update', async () => {
  const fs = seedUsers();
  const db = fs.asFirestore();
  const results = [
    await updateOwnPhone(null, '9876543210', db),
    await updateOwnPhone({ id: 'usr_p1', role: 'STAFF' }, '9876543210', db),
    await updateOwnPhone({ id: 'usr_p1', role: 'ADMIN' }, '9876543210', db),
    await updateOwnPhone({ id: 'usr_deleted', role: 'PARENT' }, '9876543210', db),
  ];
  assert.deepEqual(results.map((r) => (r.ok ? 200 : r.status)), [401, 403, 403, 404]);
  assert.equal(fs.getDoc('users', 'usr_p1')?.phone, null);
});

test('Cashfree orders are refused without a real customer phone (no placeholder substitution)', async () => {
  env.CASHFREE_APP_ID = 'test_app_id';
  env.CASHFREE_SECRET_KEY = 'test_secret_key';
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const customer = { customerId: 'par_1', customerName: 'P', customerEmail: 'p@example.com' };
  for (const customerPhone of ['', '12345', '0000000000']) {
    await assert.rejects(
      createCashfreeOrder({ orderId: 'ORD-1', orderAmount: 60, customer: { ...customer, customerPhone }, returnUrl: 'https://x.example' }),
      /valid 10-digit customer mobile number/
    );
  }
  assert.equal(called, false, 'no request is sent to Cashfree');
});

test('teacher checkout phone: typed number, else saved number, never a substitute', () => {
  // Saved valid number and nothing typed: no extra step.
  assert.deepEqual(resolveCheckoutPhone('', '+91 98765 43210'), { ok: true, phone: '9876543210' });
  assert.deepEqual(resolveCheckoutPhone(undefined, '9876543210'), { ok: true, phone: '9876543210' });
  // A typed valid number is used for this payment (and not saved anywhere).
  assert.deepEqual(resolveCheckoutPhone('9123456780', '9876543210'), { ok: true, phone: '9123456780' });
  // A typed invalid number is an error even if a valid one is saved.
  const invalid = resolveCheckoutPhone('12345', '9876543210');
  assert.equal(invalid.ok, false);
  assert.equal(!invalid.ok && invalid.code, 'PHONE_INVALID');
  // Missing everywhere (or saved number invalid): required, no placeholder.
  for (const saved of [null, undefined, '', '12345']) {
    const missing = resolveCheckoutPhone('   ', saved);
    assert.equal(!missing.ok && missing.code, 'PHONE_REQUIRED', String(saved));
  }
  assert.equal(JSON.stringify(resolveCheckoutPhone('', null)).includes('9999999999'), false);
});
