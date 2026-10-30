import './helpers/isolate-env';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeFirestore } from './helpers/fake-firestore';
import { jsonRequest, signedInAs, useFakeFirestore } from './helpers/session';
import { setFirestoreForTesting } from '../lib/firebase-admin';
import { GET as publicTeacherMenu } from '../app/api/teacher/menu/route';
import * as staffMenu from '../app/api/staff/teacher-menu/route';

let fs: FakeFirestore;
let staff: Record<string, string>;

beforeEach(async () => {
  fs = useFakeFirestore();
  staff = await signedInAs(fs, 'STAFF');
});

afterEach(() => setFirestoreForTesting(null));

const menuNames = async () => ((await (await publicTeacherMenu()).json()).meals as any[]).map((m) => m.name);

test('default teacher items are created once; items staff remove stay removed', async () => {
  assert.ok((await menuNames()).length > 0, 'a brand-new database starts with the default menu');
  for (const m of fs.list('teacher_meals')) {
    assert.equal((await staffMenu.DELETE(jsonRequest(`/api/staff/teacher-menu?id=${m.id}`, 'DELETE', undefined, staff))).status, 200);
  }
  assert.deepEqual(await menuNames(), [], 'deleted items do not reappear');
  assert.equal(fs.list('teacher_meals').length, 0);
});

test('an existing teacher menu is never re-seeded after staff empty it', async () => {
  fs.seed('teacher_meals', 'TM-X', { id: 'TM-X', name: 'Masala Dosa', price: 60, isAvailable: true });
  assert.deepEqual(await menuNames(), ['Masala Dosa']);
  await staffMenu.DELETE(jsonRequest('/api/staff/teacher-menu?id=TM-X', 'DELETE', undefined, staff));
  assert.deepEqual(await menuNames(), []);
});

test('staff edits persist, invalid prices are refused, and disabled items are hidden from teachers', async () => {
  fs.seed('teacher_meals', 'TM-1', { id: 'TM-1', name: 'Veg Thali', price: 120, isAvailable: true, description: 'Thali' });
  const put = (body: Record<string, unknown>) => staffMenu.PUT(jsonRequest('/api/staff/teacher-menu', 'PUT', { id: 'TM-1', ...body }, staff));

  assert.equal((await put({ price: 130, name: 'Deluxe Thali' })).status, 200);
  assert.equal(fs.getDoc('teacher_meals', 'TM-1')?.price, 130);
  assert.equal(fs.getDoc('teacher_meals', 'TM-1')?.name, 'Deluxe Thali');

  for (const price of [0, -10, 'abc', '', null]) {
    assert.equal((await put({ price })).status, 400, String(price));
  }
  assert.equal((await put({ name: '   ' })).status, 400);
  assert.equal(fs.getDoc('teacher_meals', 'TM-1')?.price, 130);

  assert.equal((await put({ isAvailable: false })).status, 200);
  assert.deepEqual(await menuNames(), []);

  const add = await staffMenu.POST(jsonRequest('/api/staff/teacher-menu', 'POST', { name: 'Poha', price: 40 }, staff));
  assert.ok(add.ok, `add returned ${add.status}`);
  assert.ok(fs.list('teacher_meals').some((m) => m.name === 'Poha' && m.price === 40));
  assert.equal((await staffMenu.POST(jsonRequest('/api/staff/teacher-menu', 'POST', { name: 'Free', price: 0 }, staff))).status, 400);
});

test('only staff and admins can change the teacher menu', async () => {
  fs.seed('teacher_meals', 'TM-1', { id: 'TM-1', name: 'Veg Thali', price: 120, isAvailable: true });
  const parent = await signedInAs(fs, 'PARENT');
  for (const headers of [parent, {}]) {
    assert.equal((await staffMenu.PUT(jsonRequest('/api/staff/teacher-menu', 'PUT', { id: 'TM-1', price: 1 }, headers))).status, 403);
    assert.equal((await staffMenu.DELETE(jsonRequest('/api/staff/teacher-menu?id=TM-1', 'DELETE', undefined, headers))).status, 403);
  }
  assert.equal(fs.getDoc('teacher_meals', 'TM-1')?.price, 120);
});
