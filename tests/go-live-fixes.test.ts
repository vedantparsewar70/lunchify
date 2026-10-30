import './helpers/isolate-env';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeFirestore } from './helpers/fake-firestore';
import { jsonRequest, signedInAs, useFakeFirestore } from './helpers/session';
import { setFirestoreForTesting } from '../lib/firebase-admin';
import { createSessionToken, resolveSessionUser } from '../lib/auth';
import { PUT as editChild } from '../app/api/parent/children/route';
import { GET as listPayments } from '../app/api/parent/payments/route';
import { POST as createMenu, PUT as updateMenu } from '../app/api/admin/menus/route';
import { GET as kitchenSummary } from '../app/api/admin/kitchen/route';

let fs: FakeFirestore;
let parent: Record<string, string>;
let staff: Record<string, string>;

beforeEach(async () => {
  fs = useFakeFirestore();
  parent = await signedInAs(fs, 'PARENT');
  staff = await signedInAs(fs, 'STAFF');
});

afterEach(() => setFirestoreForTesting(null));

test("editing a child's name keeps the allergies the school recorded", async () => {
  fs.seed('students', 'stu_1', { id: 'stu_1', parentId: 'par_usr_parent', name: 'Riya', grade: 'Primary', studentCategory: 'Primary', allergies: 'Peanut', isActive: true });
  fs.seed('allergies', 'alg_peanut', { id: 'alg_peanut', name: 'Peanut' });
  fs.seed('studentAllergies', 'sa_1', { id: 'sa_1', studentId: 'stu_1', allergyId: 'alg_peanut' });

  // Exactly what the parent edit form sends: no allergy fields.
  const res = await editChild(jsonRequest('/api/parent/children', 'PUT', {
    id: 'stu_1', name: 'Riya Sharma', dob: null, category: 'Primary', studentCategory: 'Primary', grade: 'Primary',
  }, parent));
  assert.equal(res.status, 200);
  assert.equal(fs.getDoc('students', 'stu_1')?.name, 'Riya Sharma');
  assert.equal(fs.getDoc('students', 'stu_1')?.allergies, 'Peanut');
  assert.equal(fs.list('studentAllergies').length, 1);

  // Sending allergies explicitly still replaces them, and an empty name is refused.
  await editChild(jsonRequest('/api/parent/children', 'PUT', { id: 'stu_1', allergies: '' }, parent));
  assert.equal(fs.getDoc('students', 'stu_1')?.allergies, null);
  assert.equal(fs.list('studentAllergies').length, 0);
  const blank = await editChild(jsonRequest('/api/parent/children', 'PUT', { id: 'stu_1', name: '   ' }, parent));
  assert.equal(blank.status, 400);
  assert.equal(fs.getDoc('students', 'stu_1')?.name, 'Riya Sharma');
});

test("a parent's payment history lists only that parent's payments", async () => {
  fs.seed('orders', 'ORD-MINE', { id: 'ORD-MINE', parentId: 'par_usr_parent', paymentStatus: 'PAID', totalAmount: 80 });
  fs.seed('orders', 'ORD-OTHER', { id: 'ORD-OTHER', parentId: 'par_someone_else', paymentStatus: 'PAID', totalAmount: 90 });
  fs.seed('payments', 'PAY-1', { id: 'PAY-1', orderId: 'ORD-MINE', amount: 80, status: 'SUCCESS', createdAt: '2026-11-01T04:00:00Z' });
  fs.seed('payments', 'PAY-2', { id: 'PAY-2', orderId: 'ORD-OTHER', amount: 90, status: 'SUCCESS', createdAt: '2026-11-01T04:00:00Z' });

  const res = await listPayments(jsonRequest('/api/parent/payments', 'GET', undefined, parent));
  assert.equal(res.status, 200);
  const { payments } = await res.json();
  assert.deepEqual(payments.map((p: { id: string }) => p.id), ['PAY-1']);
});

test('a database outage during the session check is an error, not a sign-out', async () => {
  const token = await createSessionToken({ userId: 'usr_staff', email: 'usr_staff@example.com', name: 'STAFF', role: 'STAFF' });
  const failing = async () => {
    throw new Error('UNAVAILABLE');
  };
  // API routes keep failing closed ...
  assert.equal(await resolveSessionUser(token, failing), null);
  // ... while /api/auth/me reports the outage, so the app keeps staff signed in.
  await assert.rejects(resolveSessionUser(token, failing, { throwOnUnavailable: true }), /UNAVAILABLE/);
});

test('staff cannot batch-publish a whole day through the menu edit route, and quantities are validated', async () => {
  fs.seed('meals', 'meal_soya', { id: 'meal_soya', name: 'Soyabean Masala', price: 80, category: 'LUNCH', isVegetarian: true });
  fs.seed('menus', 'menu_2099-01-05_primary', { id: 'menu_2099-01-05_primary', mealId: 'meal_soya', date: '2099-01-05', studentCategory: 'Primary', availableQuantity: 10, isActive: true });

  const batch = await updateMenu(jsonRequest('/api/admin/menus', 'PUT', { date: '2099-01-05', selectedMealIds: [] }, staff));
  assert.equal(batch.status, 403);
  assert.equal(fs.getDoc('menus', 'menu_2099-01-05_primary')?.isActive, true, 'nothing switched off');

  for (const bad of [-1, 'abc', 2.5]) {
    const res = await updateMenu(jsonRequest('/api/admin/menus', 'PUT', { id: 'menu_2099-01-05_primary', availableQuantity: bad }, staff));
    assert.equal(res.status, 400, `rejects ${bad}`);
  }
  const created = await createMenu(jsonRequest('/api/admin/menus', 'POST', { mealId: 'meal_soya', date: '2099-01-06', availableQuantity: -5 }, staff));
  assert.equal(created.status, 400);
  assert.equal(fs.getDoc('menus', 'menu_2099-01-05_primary')?.availableQuantity, 10);

  const ok = await updateMenu(jsonRequest('/api/admin/menus', 'PUT', { id: 'menu_2099-01-05_primary', availableQuantity: 0 }, staff));
  assert.equal(ok.status, 200);
  assert.equal(fs.getDoc('menus', 'menu_2099-01-05_primary')?.availableQuantity, 0);
});

test('the kitchen summary also reports paid teacher meals, separately from student counts', async () => {
  fs.seed('teacher_orders', 'TCH-1', { id: 'TCH-1', date: '2099-01-05', paymentStatus: 'PAID', orderStatus: 'CONFIRMED', items: [{ mealId: 'meal_soya', mealName: 'Soyabean Masala', quantity: 2 }] });
  fs.seed('teacher_orders', 'TCH-2', { id: 'TCH-2', date: '2099-01-05', paymentStatus: 'PENDING', items: [{ mealId: 'meal_soya', mealName: 'Soyabean Masala', quantity: 5 }] });
  fs.seed('teacher_orders', 'TCH-3', { id: 'TCH-3', date: '2099-01-05', paymentStatus: 'PAID', orderStatus: 'CANCELLED', items: [{ mealId: 'meal_soya', mealName: 'Soyabean Masala', quantity: 7 }] });

  const res = await kitchenSummary(jsonRequest('/api/admin/kitchen?date=2099-01-05&refresh=true', 'GET', undefined, staff));
  const data = await res.json();
  assert.equal(data.teacherOrderCount, 1);
  assert.equal(data.teacherMealsTotal, 2, 'unpaid and cancelled teacher orders are not counted');
  assert.deepEqual(data.teacherMeals, [{ mealName: 'Soyabean Masala', quantity: 2 }]);
  assert.equal(data.totalMeals, 0, 'student totals unchanged');
});
