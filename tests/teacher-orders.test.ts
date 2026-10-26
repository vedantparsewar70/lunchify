import './helpers/isolate-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeFirestore } from './helpers/fake-firestore';
import { canAccessTeacherOrder, generateTeacherOrderId, resolveTeacherCart } from '../lib/teacher-orders';

function catalog() {
  const fs = new FakeFirestore();
  fs.seed('teacher_meals', 'TM-001', { id: 'TM-001', name: 'Veg Thali', price: 120, category: 'LUNCH', isAvailable: true, isVegetarian: true });
  fs.seed('teacher_meals', 'TM-002', { id: 'TM-002', name: 'Sandwich', price: 70, category: 'SNACK', isAvailable: false });
  fs.seed('teacher_meals', 'TM-003', { id: 'TM-003', name: 'Broken', price: 0 });
  return fs.asFirestore();
}

test('client-supplied price, name and category are ignored', async () => {
  const result = await resolveTeacherCart(
    [{ mealId: 'TM-001', quantity: 2, price: 1, unitPrice: 1, mealName: 'Free Lunch', category: 'FREE' }],
    catalog()
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.totalAmount, 240);
  assert.equal(result.items[0].unitPrice, 120);
  assert.equal(result.items[0].mealName, 'Veg Thali');
  assert.equal(result.items[0].category, 'LUNCH');
});

test('unknown, unavailable, unpriced meals and bad quantities are rejected', async () => {
  const db = catalog();
  for (const items of [
    [{ mealId: 'TM-999', quantity: 1, price: 10 }],
    [{ mealId: 'TM-002', quantity: 1 }],
    [{ mealId: 'TM-003', quantity: 1 }],
    [{ mealId: 'TM-001', quantity: 0 }],
    [{ mealId: 'TM-001', quantity: 1.5 }],
    [{ mealId: 'TM-001', quantity: 51 }],
    [{ mealId: '', quantity: 1 }],
    [],
    'not-an-array',
  ]) {
    const result = await resolveTeacherCart(items, db);
    assert.equal(result.ok, false, JSON.stringify(items));
  }
});

test('teacher orders are visible only to admins and the staff account that placed them', () => {
  const owned = { userId: 'usr_staff_1' };
  assert.equal(canAccessTeacherOrder(null, owned), false);
  assert.equal(canAccessTeacherOrder({ id: 'usr_parent', role: 'PARENT' }, owned), false);
  assert.equal(canAccessTeacherOrder({ id: 'usr_staff_2', role: 'STAFF' }, owned), false);
  assert.equal(canAccessTeacherOrder({ id: 'usr_staff_1', role: 'STAFF' }, owned), true);
  assert.equal(canAccessTeacherOrder({ id: 'usr_admin', role: 'ADMIN' }, owned), true);
  // Legacy orders without an owner stay visible to staff (as in the staff order list)
  assert.equal(canAccessTeacherOrder({ id: 'usr_staff_2', role: 'STAFF' }, {}), true);
  assert.equal(canAccessTeacherOrder({ id: 'usr_parent', role: 'PARENT' }, {}), false);
});

test('teacher order IDs are random and not guessable', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => generateTeacherOrderId()));
  assert.equal(ids.size, 1000);
  for (const id of ids) assert.match(id, /^TCH-[A-F0-9]{16}$/);
});
