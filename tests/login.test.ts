import './helpers/isolate-env';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../lib/prisma';
import { hashPassword, TOKEN_COOKIE_NAME } from '../lib/auth';
import { POST as login } from '../app/api/auth/login/route';
import { POST as placeTeacherOrder } from '../app/api/teacher/orders/route';

const env = process.env as Record<string, string | undefined>;
const userStore = prisma.user as any;
const original = { findUnique: userStore.findUnique, create: userStore.create, upsert: userStore.upsert };

/** In-memory stand-in for the Firestore `users` collection. */
let users: Record<string, any>;
let writes: string[];
let failLookups: boolean;
let ipCounter = 0;

beforeEach(() => {
  users = {};
  writes = [];
  failLookups = false;
  userStore.findUnique = async ({ where }: any) => {
    if (failLookups) throw new Error('16 UNAUTHENTICATED: internal detail');
    const found = where.id ? users[where.id] : Object.values(users).find((u: any) => u.email === where.email);
    return found ? { ...found, parent: null } : null;
  };
  userStore.create = async ({ data }: any) => {
    writes.push(`create:${data.id}`);
    users[data.id] = { ...data };
    return { ...data };
  };
  userStore.upsert = async ({ where, update }: any) => {
    writes.push(`upsert:${where.id}`);
    users[where.id] = { ...users[where.id], ...update };
    return { ...users[where.id] };
  };
});

afterEach(() => {
  Object.assign(userStore, original);
  delete env.STAFF_EMAIL;
  delete env.STAFF_PASS;
});

function loginRequest(body: Record<string, unknown>) {
  return new Request('https://preview.example/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${++ipCounter}` },
    body: JSON.stringify(body),
  });
}

async function seedUser(id: string, email: string, role: string, password: string) {
  users[id] = { id, email, name: role, role, passwordHash: await hashPassword(password) };
}

function sessionToken(res: Response): string {
  const match = (res.headers.get('set-cookie') || '').match(new RegExp(`${TOKEN_COOKIE_NAME}=([^;]+)`));
  assert.ok(match, 'session cookie is set');
  return match[1];
}

function teacherOrderRequest(token?: string) {
  return new Request('https://preview.example/api/teacher/orders', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.1.0.${++ipCounter}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ teacherName: 'T', items: [] }),
  });
}

test('a database failure during login is reported as unavailable, not as a wrong password', async () => {
  failLookups = true;
  env.STAFF_EMAIL = 'staff@school.com';
  env.STAFF_PASS = 'test-only-staff-pass';

  for (const password of ['test-only-staff-pass', 'wrong-password']) {
    const res = await login(loginRequest({ email: 'staff@school.com', password, requestedRole: 'staff' }));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.doesNotMatch(body.error, /Invalid email or password/);
    assert.doesNotMatch(JSON.stringify(body), /UNAUTHENTICATED|internal detail/);
  }
  assert.deepEqual(writes, [], 'no account is auto-provisioned or overwritten when the lookup failed');
});

test('an empty staging database without STAFF_EMAIL/STAFF_PASS rejects staff login', async () => {
  const res = await login(loginRequest({ email: 'staff@school.com', password: 'anything', requestedRole: 'staff' }));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'Invalid email or password');
  assert.deepEqual(writes, []);
});

test('STAFF_EMAIL/STAFF_PASS provision a STAFF account on first login; a wrong password does not', async () => {
  env.STAFF_EMAIL = 'staff@school.com';
  env.STAFF_PASS = 'test-only-staff-pass';

  const wrong = await login(loginRequest({ email: 'staff@school.com', password: 'nope', requestedRole: 'staff' }));
  assert.equal(wrong.status, 401);
  assert.deepEqual(writes, []);

  const res = await login(loginRequest({ email: 'staff@school.com', password: 'test-only-staff-pass', requestedRole: 'staff' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.role, 'STAFF');
  assert.equal(body.redirectUrl, '/staff/kitchen');
  assert.deepEqual(writes, ['create:usr_canteen_staff_01']);
  assert.notEqual(users.usr_canteen_staff_01.passwordHash, 'test-only-staff-pass', 'only a hash is stored');
  sessionToken(res);
});

test('a stored staff account logs in with its password; staff and admin logins stay separate', async () => {
  await seedUser('usr_s', 'staff@school.com', 'STAFF', 'staff-secret-1');
  await seedUser('usr_p', 'parent@example.com', 'PARENT', 'parent-secret-1');

  const ok = await login(loginRequest({ email: 'staff@school.com', password: 'staff-secret-1', requestedRole: 'staff' }));
  assert.equal(ok.status, 200);
  assert.equal((await login(loginRequest({ email: 'staff@school.com', password: 'bad', requestedRole: 'staff' }))).status, 401);
  assert.equal((await login(loginRequest({ email: 'staff@school.com', password: 'staff-secret-1', requestedRole: 'admin' }))).status, 403);
  assert.equal((await login(loginRequest({ email: 'parent@example.com', password: 'parent-secret-1', requestedRole: 'staff' }))).status, 403);
  assert.deepEqual(writes, []);
});

test('the staff session from login is accepted by the teacher-order API; others are rejected', async () => {
  await seedUser('usr_s', 'staff@school.com', 'STAFF', 'staff-secret-1');
  await seedUser('usr_p', 'parent@example.com', 'PARENT', 'parent-secret-1');
  const staffToken = sessionToken(await login(loginRequest({ email: 'staff@school.com', password: 'staff-secret-1', requestedRole: 'staff' })));
  const parentToken = sessionToken(await login(loginRequest({ email: 'parent@example.com', password: 'parent-secret-1' })));

  // Past authentication and authorization: stops at cart validation, before any payment call.
  const staff = await placeTeacherOrder(teacherOrderRequest(staffToken));
  assert.equal(staff.status, 400);
  assert.match((await staff.json()).error, /cart is empty/);

  assert.equal((await placeTeacherOrder(teacherOrderRequest(parentToken))).status, 403);
  assert.equal((await placeTeacherOrder(teacherOrderRequest())).status, 401);
  assert.equal((await placeTeacherOrder(teacherOrderRequest('forged.token.value'))).status, 401);

  delete users.usr_s; // a deleted staff account loses access immediately
  assert.equal((await placeTeacherOrder(teacherOrderRequest(staffToken))).status, 401);
});
