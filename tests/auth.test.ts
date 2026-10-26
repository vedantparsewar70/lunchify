import './helpers/isolate-env';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, getJwtSecret, resolveSessionUser } from '../lib/auth';

const env = process.env as Record<string, string | undefined>;
const savedSecret = env.JWT_SECRET;
const savedNodeEnv = env.NODE_ENV;

afterEach(() => {
  env.JWT_SECRET = savedSecret;
  env.NODE_ENV = savedNodeEnv;
});

const adminToken = () =>
  createSessionToken({ userId: 'usr_1', email: 'a@example.com', name: 'A', role: 'ADMIN' });

test('a deleted user’s token no longer authenticates', async () => {
  const user = await resolveSessionUser(await adminToken(), async () => null);
  assert.equal(user, null);
});

test('a demoted user gets the role stored in the database, not the token’s role', async () => {
  const user = await resolveSessionUser(await adminToken(), async (id) => ({
    id, email: 'a@example.com', name: 'A', role: 'PARENT', parent: { id: 'par_1', students: [] },
  }));
  assert.equal(user?.role, 'PARENT');
  assert.equal(user?.parentId, 'par_1');
});

test('sessions fail closed when the user lookup fails or the token is invalid', async () => {
  assert.equal(await resolveSessionUser(await adminToken(), async () => { throw new Error('db down'); }), null);
  assert.equal(await resolveSessionUser('not-a-jwt', async () => ({ id: 'usr_1', role: 'ADMIN' })), null);

  const token = await adminToken();
  const [h, , s] = token.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ userId: 'usr_other', role: 'ADMIN' })).toString('base64url');
  assert.equal(await resolveSessionUser(`${h}.${forgedPayload}.${s}`, async () => ({ id: 'usr_other', role: 'ADMIN' })), null);
});

test('valid sessions still work', async () => {
  const user = await resolveSessionUser(await adminToken(), async (id) => ({ id, email: 'a@example.com', name: 'A', role: 'ADMIN' }));
  assert.equal(user?.id, 'usr_1');
  assert.equal(user?.role, 'ADMIN');
});

test('production refuses a missing or short JWT secret instead of using a fallback', async () => {
  env.NODE_ENV = 'production';
  delete env.JWT_SECRET;
  assert.throws(() => getJwtSecret(), /JWT_SECRET is not set/);
  await assert.rejects(adminToken());

  env.JWT_SECRET = 'too-short';
  assert.throws(() => getJwtSecret(), /at least 32 characters/);

  env.JWT_SECRET = 'a-production-secret-that-is-long-enough-123';
  assert.ok(getJwtSecret().length > 0);

  // Tokens signed with one secret are rejected under another
  const token = await adminToken();
  env.JWT_SECRET = 'a-different-production-secret-long-enough-456';
  assert.equal(await resolveSessionUser(token, async () => ({ id: 'usr_1', role: 'ADMIN' })), null);
});
