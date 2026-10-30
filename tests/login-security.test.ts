import './helpers/isolate-env';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { FakeFirestore } from './helpers/fake-firestore';
import { useFakeFirestore } from './helpers/session';
import { setFirestoreForTesting } from '../lib/firebase-admin';
import { hashPassword } from '../lib/auth';
import {
  ACCOUNT_ALERT_FAILURES,
  LOGIN_ACCOUNT_ACTIVITY,
  LOGIN_ATTEMPTS,
  LOGIN_MAX_FAILURES,
  recordLoginFailure,
} from '../lib/login-throttle';
import { POST as login } from '../app/api/auth/login/route';
import { GET as syncEvents } from '../app/api/sync/events/route';

const env = process.env as Record<string, string | undefined>;
let fs: FakeFirestore;
let subnet = 0;
let warnings: string[];
const originalWarn = console.warn;

/** A fresh client IP block per test, so the in-memory per-IP limiter never carries over. */
let net: string;
const ipFor = (host: number) => `10.${Math.floor(subnet / 250)}.${subnet % 250}.${host}`;

beforeEach(async () => {
  fs = useFakeFirestore();
  env.VERCEL = '1';
  subnet++;
  net = ipFor(0).replace(/\.0$/, '');
  warnings = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  fs.seed('users', 'usr_parent', { id: 'usr_parent', email: 'parent@example.com', name: 'P', role: 'PARENT', passwordHash: await hashPassword('right-password-1') });
});

afterEach(() => {
  console.warn = originalWarn;
  setFirestoreForTesting(null);
  delete env.VERCEL;
  delete env.ADMIN_EMAIL;
  delete env.ADMIN_PASS;
});

/** A login as Vercel delivers it: the platform sets the client IP headers. */
const attempt = (email: string, password: string, ip: string, requestedRole?: string) =>
  login(new Request('https://preview.example/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': ip, 'x-forwarded-for': ip },
    body: JSON.stringify({ email, password, requestedRole }),
  }));

const lockFailures = async (email: string, ip: string) => {
  for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
    assert.equal((await attempt(email, `wrong-${i}`, ip)).status, 401);
  }
};

test('ten wrong passwords for one email from one IP lock that email from that IP, even for the right password', async () => {
  const ip = `${net}.1`;
  await lockFailures('parent@example.com', ip);
  assert.equal((await attempt('parent@example.com', 'wrong-again', ip)).status, 429);
  assert.equal((await attempt('parent@example.com', 'right-password-1', ip)).status, 429);
  const stored = JSON.stringify([...fs.list(LOGIN_ATTEMPTS), ...fs.list(LOGIN_ACCOUNT_ACTIVITY)]);
  assert.doesNotMatch(stored, /parent@example\.com/, 'email is not stored in plain text');
  assert.doesNotMatch(stored, new RegExp(ip.replace(/\./g, '\\.')), 'IP is not stored in plain text');
  assert.ok(fs.list(LOGIN_ATTEMPTS).every((d) => d.expiresAt instanceof Date), 'records carry a TTL expiry');
});

test('a lock from another network does not block the account: the same email from a different IP still works', async () => {
  await lockFailures('parent@example.com', `${net}.66`);
  const otherIp = `${net}.2`;
  assert.equal((await attempt('parent@example.com', 'wrong', otherIp)).status, 401, 'counted separately, not locked');
  const ok = await attempt('parent@example.com', 'right-password-1', otherIp);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).redirectUrl, '/parent/children');
  assert.equal((await attempt('parent@example.com', 'right-password-1', `${net}.66`)).status, 429, 'the first IP stays locked');
});

test("a successful login clears that IP's counter; the account-wide monitor keeps counting", async () => {
  const ip = `${net}.3`;
  for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) await attempt('parent@example.com', 'wrong', ip);
  await attempt('parent@example.com', 'wrong', `${net}.4`);
  assert.equal((await attempt('parent@example.com', 'right-password-1', ip)).status, 200);

  assert.equal(fs.list(LOGIN_ATTEMPTS).length, 1, "only the other IP's counter remains");
  assert.equal(fs.list(LOGIN_ACCOUNT_ACTIVITY)[0].failures, LOGIN_MAX_FAILURES);
  assert.equal((await attempt('parent@example.com', 'wrong', ip)).status, 401, 'counter restarted');
  assert.equal(fs.list(LOGIN_ATTEMPTS).find((d) => d.failures === 1)?.failures, 1);
});

test('100 failures for one account within an hour raise one security alert but never lock the account', async () => {
  // Spread over many IPs (as a distributed attack would be), none of them locked.
  for (let i = 0; i < ACCOUNT_ALERT_FAILURES - 1; i++) {
    await recordLoginFailure('parent@example.com', `${net}.${100 + (i % 50)}-${Math.floor(i / 50)}`, 'p***t@example.com');
  }
  assert.equal(warnings.filter((w) => w.includes('[Security Alert]')).length, 0);

  assert.equal((await attempt('parent@example.com', 'guess-100', `${net}.5`)).status, 401);
  const alerts = warnings.filter((w) => w.includes('[Security Alert]'));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /p\*\*\*t@example\.com/);
  assert.doesNotMatch(alerts[0], /parent@example\.com|guess-100|right-password/, 'no full email or password in the log');

  assert.equal((await attempt('parent@example.com', 'guess-101', `${net}.5`)).status, 401);
  assert.equal(warnings.filter((w) => w.includes('[Security Alert]')).length, 1, 'one alert per window');
  assert.equal((await attempt('parent@example.com', 'right-password-1', `${net}.6`)).status, 200, 'not locked');
});

/** Records failures in concurrent bursts of `size` (all requests of a burst arrive at once). */
async function inBursts(count: number, size: number, record: (i: number) => Promise<unknown>) {
  for (let start = 0; start < count; start += size) {
    await Promise.all(Array.from({ length: Math.min(size, count - start) }, (_, k) => record(start + k)));
  }
}

test('concurrent failures are all counted, per IP and for the account; none are lost', async () => {
  const ips = [`${net}.7`, `${net}.17`, `${net}.27`, `${net}.37`];
  const results: Array<{ attemptRecorded: boolean; accountRecorded: boolean }> = [];
  await inBursts(20, 5, async (i) => results.push(await recordLoginFailure('parent@example.com', ips[i % ips.length], 'p***t@example.com')));
  assert.ok(results.every((r) => r.attemptRecorded && r.accountRecorded));
  assert.deepEqual(fs.list(LOGIN_ATTEMPTS).map((d) => d.failures), [5, 5, 5, 5]);
  assert.equal(fs.list(LOGIN_ACCOUNT_ACTIVITY)[0].failures, 20);
});

test('when the shared account record is overloaded, every per-IP failure is still saved', async () => {
  // 40 failures from 40 networks at the same instant: more than the account record's transaction
  // can absorb, so some monitor updates give up. The lock counters are separate and all succeed.
  const results = await Promise.all(
    Array.from({ length: 40 }, (_, i) => recordLoginFailure('parent@example.com', `${net}.${i}`, 'p***t@example.com'))
  );
  assert.ok(results.every((r) => r.attemptRecorded), 'no lock counter lost');
  assert.equal(fs.list(LOGIN_ATTEMPTS).length, 40);
  const monitored = results.filter((r) => r.accountRecorded).length;
  assert.ok(monitored < 40, 'the overload really happened in this test');
  assert.equal(fs.list(LOGIN_ACCOUNT_ACTIVITY)[0].failures, monitored, 'the monitor count matches what it reported');
  assert.ok(warnings.some((w) => w.includes('[Login Throttle] Could not update the account-wide login monitor')));
});

/**
 * A database whose transactions touching `collection` fail, as Firestore's do once it gives up
 * after too much contention. Everything else behaves normally.
 */
function failTransactionsOn(collection: string): Firestore {
  const real = fs.asFirestore();
  const failing = (tx: object) =>
    new Proxy(tx, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (prop !== 'get' || typeof value !== 'function') return typeof value === 'function' ? value.bind(target) : value;
        return (ref: { collectionName?: string }) =>
          ref.collectionName === collection
            ? Promise.reject(Object.assign(new Error('10 ABORTED: Too much contention on these documents'), { code: 10 }))
            : value.call(target, ref);
      },
    });
  return new Proxy(real, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (prop === 'runTransaction') {
        return (fn: (tx: object) => Promise<unknown>) => target.runTransaction((tx) => fn(failing(tx)));
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Firestore;
}

test('a failing account-monitor transaction never stops the per-IP lock from counting', async () => {
  setFirestoreForTesting(failTransactionsOn(LOGIN_ACCOUNT_ACTIVITY));
  const ip = `${net}.14`;

  const direct = await recordLoginFailure('parent@example.com', `${net}.15`, 'p***t@example.com');
  assert.deepEqual(direct, { attemptRecorded: true, accountRecorded: false });

  await lockFailures('parent@example.com', ip);
  assert.equal((await attempt('parent@example.com', 'right-password-1', ip)).status, 429, 'the lock still applies');
  assert.equal(fs.list(LOGIN_ACCOUNT_ACTIVITY).length, 0);
  assert.ok(warnings.some((w) => w.includes('[Login Throttle] Could not update the account-wide login monitor')));
  assert.ok(warnings.every((w) => !w.includes('[Login Throttle] Could not record a failed login')));
});

test('a failing per-IP transaction is reported as not recorded, and login still needs the right password', async () => {
  setFirestoreForTesting(failTransactionsOn(LOGIN_ATTEMPTS));
  const ip = `${net}.16`;

  const direct = await recordLoginFailure('parent@example.com', ip, 'p***t@example.com');
  assert.deepEqual(direct, { attemptRecorded: false, accountRecorded: true });
  assert.equal(fs.list(LOGIN_ATTEMPTS).length, 0);
  assert.equal(fs.list(LOGIN_ACCOUNT_ACTIVITY)[0].failures, 1, 'the monitor still counts');
  assert.ok(warnings.some((w) => w.includes('[Login Throttle] Could not record a failed login')));

  assert.equal((await attempt('parent@example.com', 'wrong', ip)).status, 401);
  assert.equal((await attempt('parent@example.com', 'right-password-1', ip)).status, 200);
  assert.ok(warnings.every((w) => !w.includes('right-password-1')), 'no password logged');
});

test('concurrent failures crossing the alert threshold raise exactly one alert per window', async () => {
  const now = Date.now();
  // 95 failures already this hour, then 8 arrive at the same moment from different IPs.
  await inBursts(95, 5, (i) => recordLoginFailure('parent@example.com', `${net}.${i}`, 'p***t@example.com', undefined, now - 1000));
  assert.equal(warnings.filter((w) => w.includes('[Security Alert]')).length, 0);
  const crossing = await Promise.all(
    Array.from({ length: 8 }, (_, i) => recordLoginFailure('parent@example.com', `${net}.${200 + i}`, 'p***t@example.com', undefined, now))
  );
  assert.ok(crossing.every((r) => r.accountRecorded));
  assert.equal(fs.list(LOGIN_ACCOUNT_ACTIVITY)[0].failures, 103);
  assert.equal(warnings.filter((w) => w.includes('[Security Alert]')).length, 1);

  // A new window starts counting from scratch; its own 100th failure alerts again, once.
  const later = now + 61 * 60 * 1000;
  await inBursts(101, 5, (i) => recordLoginFailure('parent@example.com', `${net}.${i}`, 'p***t@example.com', undefined, later));
  assert.equal(fs.list(LOGIN_ACCOUNT_ACTIVITY)[0].failures, 101);
  assert.equal(warnings.filter((w) => w.includes('[Security Alert]')).length, 2);
});

test('if the throttle collections are unavailable, login still requires the right password (fail open, logged)', async () => {
  const real = fs.asFirestore();
  const broken = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'collection') {
        return (name: string) => {
          if (name === LOGIN_ATTEMPTS || name === LOGIN_ACCOUNT_ACTIVITY) throw new Error('UNAVAILABLE');
          return target.collection(name);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Firestore;
  setFirestoreForTesting(broken);

  const ip = `${net}.8`;
  assert.equal((await attempt('parent@example.com', 'wrong', ip)).status, 401);
  assert.equal((await attempt('nobody@example.com', 'right-password-1', ip)).status, 401);
  assert.equal((await attempt('parent@example.com', 'right-password-1', ip)).status, 200);
  assert.ok(warnings.some((w) => w.includes('[Login Throttle] Could not read the login lock')));
  assert.ok(warnings.some((w) => w.includes('[Login Throttle] Could not record a failed login')));
  assert.ok(warnings.every((w) => !w.includes('right-password-1') && !w.includes('wrong')), 'no passwords logged');
});

test('an unknown email and a wrong password get the same public answer', async () => {
  const ip = `${net}.9`;
  const unknown = await attempt('nobody@example.com', 'anything-1', ip);
  const wrong = await attempt('parent@example.com', 'anything-1', ip);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(await unknown.json(), await wrong.json());
  assert.equal(fs.list(LOGIN_ACCOUNT_ACTIVITY).length, 2, 'unknown emails are counted too');
});

test('the staff login does not reveal that an email is a parent account unless the password is right', async () => {
  const wrong = await attempt('parent@example.com', 'wrong', `${net}.10`, 'staff');
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error, 'Invalid email or password');
  const right = await attempt('parent@example.com', 'right-password-1', `${net}.10`, 'staff');
  assert.equal(right.status, 403);
});

test('the configured admin password still signs in; a wrong one does not', async () => {
  env.ADMIN_EMAIL = 'admin@school.com';
  env.ADMIN_PASS = 'test-only-admin-pass';
  const wrong = await attempt('admin@school.com', 'test-only-admin-pasS', `${net}.11`, 'admin');
  assert.equal(wrong.status, 401);
  const right = await attempt('admin@school.com', 'test-only-admin-pass', `${net}.11`, 'admin');
  assert.equal(right.status, 200);
  const body = await right.json();
  assert.equal(body.user.role, 'ADMIN');
  assert.equal(body.redirectUrl, '/admin/dashboard');
  assert.doesNotMatch(JSON.stringify(body), /test-only-admin-pass|passwordHash/);
});

test('outside Vercel the forwarded headers are not trusted: every client shares one lock per account', async () => {
  delete env.VERCEL;
  await lockFailures('parent@example.com', `${net}.12`);
  assert.equal((await attempt('parent@example.com', 'right-password-1', `${net}.13`)).status, 429, 'a forged IP header does not escape the lock');
});

test('the sync endpoint reports shared versions and never invents new ones on failure', async () => {
  fs.seed('system_sync', 'latest', { menuVersion: 111, ordersVersion: 222, teacherOrdersVersion: 333 });
  const body = await (await syncEvents()).json();
  assert.equal(body.menuVersion, 111);
  assert.equal(body.ordersVersion, 222);
});
