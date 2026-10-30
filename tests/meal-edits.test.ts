import './helpers/isolate-env';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeFirestore } from './helpers/fake-firestore';
import { jsonRequest, signedInAs, useFakeFirestore } from './helpers/session';
import { setFirestoreForTesting } from '../lib/firebase-admin';
import { DELETE as deleteMeal, PUT as updateMeal } from '../app/api/admin/meals/route';

let fs: FakeFirestore;

beforeEach(() => {
  fs = useFakeFirestore();
  fs.seed('meals', 'meal_chikki', {
    id: 'meal_chikki', name: 'Peanut Chikki', category: 'SNACK', price: 30, isVegetarian: true,
    allergens: 'Peanuts, Sesame', imageUrl: 'https://img.example/chikki.png',
  });
  fs.seed('allergens', 'alg_peanuts', { id: 'alg_peanuts', name: 'Peanuts' });
  fs.seed('allergens', 'alg_sesame', { id: 'alg_sesame', name: 'Sesame' });
  fs.seed('mealAllergens', 'meal_chikki_alg_peanuts', { id: 'meal_chikki_alg_peanuts', mealId: 'meal_chikki', allergenId: 'alg_peanuts' });
  fs.seed('mealAllergens', 'meal_chikki_alg_sesame', { id: 'meal_chikki_alg_sesame', mealId: 'meal_chikki', allergenId: 'alg_sesame' });
});

afterEach(() => setFirestoreForTesting(null));

const allergenLinks = () => fs.list('mealAllergens').filter((l) => l.mealId === 'meal_chikki').map((l) => l.allergenId).sort();

test('a price-only edit (what the staff edit form sends) keeps allergens and the image', async () => {
  const staff = await signedInAs(fs, 'STAFF');
  const res = await updateMeal(jsonRequest('/api/admin/meals', 'PUT', {
    id: 'meal_chikki', name: 'Peanut Chikki', category: 'SNACK', price: 35, isVegetarian: true,
  }, staff));
  assert.equal(res.status, 200);

  const meal = fs.getDoc('meals', 'meal_chikki')!;
  assert.equal(meal.price, 35);
  assert.equal(meal.allergens, 'Peanuts, Sesame');
  assert.equal(meal.imageUrl, 'https://img.example/chikki.png');
  assert.deepEqual(allergenLinks(), ['alg_peanuts', 'alg_sesame']);
});

test('a name-only edit keeps allergens', async () => {
  const staff = await signedInAs(fs, 'STAFF');
  assert.equal((await updateMeal(jsonRequest('/api/admin/meals', 'PUT', { id: 'meal_chikki', name: 'Chikki Bar' }, staff))).status, 200);
  assert.equal(fs.getDoc('meals', 'meal_chikki')!.name, 'Chikki Bar');
  assert.equal(fs.getDoc('meals', 'meal_chikki')!.allergens, 'Peanuts, Sesame');
  assert.deepEqual(allergenLinks(), ['alg_peanuts', 'alg_sesame']);
});

test('an explicit allergen update replaces the allergens, including clearing them deliberately', async () => {
  const admin = await signedInAs(fs, 'ADMIN');
  await updateMeal(jsonRequest('/api/admin/meals', 'PUT', { id: 'meal_chikki', allergensList: ['Peanuts'] }, admin));
  assert.equal(fs.getDoc('meals', 'meal_chikki')!.allergens, 'Peanuts');
  assert.deepEqual(allergenLinks(), ['alg_peanuts']);

  await updateMeal(jsonRequest('/api/admin/meals', 'PUT', { id: 'meal_chikki', allergens: '' }, admin));
  assert.equal(fs.getDoc('meals', 'meal_chikki')!.allergens, null);
  assert.deepEqual(allergenLinks(), []);
});

test('invalid prices, empty names and unknown meals are rejected without changes', async () => {
  const staff = await signedInAs(fs, 'STAFF');
  for (const body of [{ price: 0 }, { price: -5 }, { price: 'abc' }, { price: '' }, { price: null }, { name: '  ' }]) {
    const res = await updateMeal(jsonRequest('/api/admin/meals', 'PUT', { id: 'meal_chikki', ...body }, staff));
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal((await updateMeal(jsonRequest('/api/admin/meals', 'PUT', { id: 'meal_nope', price: 10 }, staff))).status, 404);
  assert.equal(fs.getDoc('meals', 'meal_chikki')!.price, 30);
  assert.equal(fs.list('meals').length, 1, 'no stray meal document created');
});

test('parents and signed-out users cannot edit meals', async () => {
  const parent = await signedInAs(fs, 'PARENT');
  assert.equal((await updateMeal(jsonRequest('/api/admin/meals', 'PUT', { id: 'meal_chikki', price: 1 }, parent))).status, 403);
  assert.equal((await updateMeal(jsonRequest('/api/admin/meals', 'PUT', { id: 'meal_chikki', price: 1 }))).status, 403);
  assert.equal(fs.getDoc('meals', 'meal_chikki')!.price, 30);
});

test('a meal with orders cannot be deleted; an unused meal can (admin only)', async () => {
  const admin = await signedInAs(fs, 'ADMIN');
  const staff = await signedInAs(fs, 'STAFF');
  fs.seed('meals', 'meal_unused', { id: 'meal_unused', name: 'Unused', price: 10 });
  fs.seed('orderItems', 'oit_1', { id: 'oit_1', orderId: 'ORD-1', mealId: 'meal_chikki' });

  const del = (id: string, headers: Record<string, string>) => deleteMeal(jsonRequest(`/api/admin/meals?id=${id}`, 'DELETE', undefined, headers));
  assert.equal((await del('meal_unused', staff)).status, 403);
  assert.equal((await del('meal_chikki', admin)).status, 400);
  assert.ok(fs.getDoc('meals', 'meal_chikki'));
  assert.equal((await del('meal_unused', admin)).status, 200, 'an order for another meal does not block deletion');
  assert.equal(fs.getDoc('meals', 'meal_unused'), undefined);
});
