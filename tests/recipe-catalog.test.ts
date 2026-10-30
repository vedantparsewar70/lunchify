import './helpers/isolate-env';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { FakeFirestore } from './helpers/fake-firestore';
import { jsonRequest, signedInAs, useFakeFirestore } from './helpers/session';
import { setFirestoreForTesting } from '../lib/firebase-admin';
import { GET as listMeals, POST as createMeal } from '../app/api/admin/meals/route';

let fs: FakeFirestore;
let staff: Record<string, string>;

/** Exactly what Staff → Master Recipe Catalog → Add New Recipe sends. */
const recipe = (overrides: Record<string, unknown> = {}) => ({
  name: 'Veg Pulao + Raita',
  category: 'LUNCH',
  price: 85,
  isVegetarian: true,
  description: 'Veg Pulao + Raita - Prepared fresh at school canteen',
  ...overrides,
});
const add = (body: unknown, headers: Record<string, string> = staff) => createMeal(jsonRequest('/api/admin/meals', 'POST', body, headers));
const catalogNames = async () =>
  ((await (await listMeals(jsonRequest('/api/admin/meals', 'GET'))).json()).meals as Array<{ name: string }>).map((m) => m.name);

beforeEach(async () => {
  fs = useFakeFirestore();
  staff = await signedInAs(fs, 'STAFF');
  fs.seed('meals', 'meal_dal', { id: 'meal_dal', name: 'Dal Khichdi', category: 'LUNCH', price: 70, isVegetarian: true, allergens: 'Mustard' });
  fs.seed('menus', 'menu_2099-01-05_primary', { id: 'menu_2099-01-05_primary', mealId: 'meal_dal', date: '2099-01-05', studentCategory: 'Primary', availableQuantity: 40, isActive: true });
});

afterEach(() => setFirestoreForTesting(null));

test('staff add a recipe: it is saved and the catalog lists it; existing recipes and daily menus are untouched', async () => {
  const before = { dal: fs.getDoc('meals', 'meal_dal'), menu: fs.getDoc('menus', 'menu_2099-01-05_primary') };
  const res = await add(recipe());
  assert.equal(res.status, 201);
  const { meal } = await res.json();
  assert.equal(meal.name, 'Veg Pulao + Raita');
  assert.equal(meal.price, 85);
  assert.equal(meal.category, 'LUNCH');
  assert.equal(meal.isVegetarian, true);

  const saved = fs.getDoc('meals', meal.id)!;
  assert.equal(saved.name, 'Veg Pulao + Raita');
  assert.deepEqual(await catalogNames(), ['Dal Khichdi', 'Veg Pulao + Raita'], 'the catalog refresh returns the new recipe');

  assert.deepEqual(fs.getDoc('meals', 'meal_dal'), before.dal, 'existing recipe unchanged');
  assert.deepEqual(fs.getDoc('menus', 'menu_2099-01-05_primary'), before.menu, 'daily menu unchanged');
  assert.equal(fs.list('menus').length, 1, 'adding a recipe does not schedule it on any day');
});

test('admins can add recipes too (the admin menu page uses the same endpoint)', async () => {
  const admin = await signedInAs(fs, 'ADMIN');
  const res = await add(recipe({ name: 'Poha', category: 'BREAKFAST', price: 40.5, isVegetarian: false }), admin);
  assert.equal(res.status, 201);
  assert.equal((await res.json()).meal.price, 40.5);
});

test('invalid input is refused with a clear message and nothing is saved', async () => {
  const cases: Array<[unknown, RegExp]> = [
    [recipe({ name: '' }), /recipe name/],
    [recipe({ name: '   ' }), /recipe name/],
    [recipe({ name: 'A' }), /recipe name/],
    [recipe({ name: 'x'.repeat(101) }), /recipe name/],
    [recipe({ name: 42 }), /recipe name/],
    [recipe({ price: 0 }), /valid rate/],
    [recipe({ price: -5 }), /valid rate/],
    [recipe({ price: 'abc' }), /valid rate/],
    [recipe({ price: '' }), /valid rate/],
    [recipe({ price: 10001 }), /valid rate/],
    [recipe({ price: undefined }), /valid rate/],
    [recipe({ category: 'DINNER' }), /category/],
    [recipe({ isVegetarian: 'yes' }), /Vegetarian/],
  ];
  for (const [body, message] of cases) {
    const res = await add(body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.match((await res.json()).error, message);
  }
  const malformed = await createMeal(new Request('http://localhost:3000/api/admin/meals', {
    method: 'POST', headers: { 'content-type': 'application/json', ...staff }, body: '{not json',
  }));
  assert.equal(malformed.status, 400);
  assert.equal(fs.list('meals').length, 1, 'nothing saved');
});

test('only staff and admins can add recipes', async () => {
  const parent = await signedInAs(fs, 'PARENT');
  assert.equal((await add(recipe(), {})).status, 403, 'signed out');
  assert.equal((await add(recipe(), parent)).status, 403, 'parent');
  assert.equal((await add(recipe(), { authorization: 'Bearer not-a-real-token' })).status, 403, 'forged token');
  assert.equal(fs.list('meals').length, 1);
});

test('adding the same recipe twice (double click, or added earlier) keeps one catalog entry', async () => {
  assert.equal((await add(recipe())).status, 201);
  const again = await add(recipe({ name: '  veg pulao   +  RAITA ' }));
  assert.equal(again.status, 409);
  const body = await again.json();
  assert.equal(body.code, 'DUPLICATE_RECIPE');
  assert.match(body.error, /already in the catalog/);
  assert.equal(fs.list('meals').filter((m) => /pulao/i.test(String(m.name))).length, 1);
});

test('a database failure is reported as an error, with no internal details and nothing half-saved', async () => {
  const real = fs.asFirestore();
  const failingWrites = new Proxy(real, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (prop !== 'collection') return typeof value === 'function' ? value.bind(target) : value;
      return (name: string) => {
        const collection = target.collection(name);
        if (name !== 'meals') return collection;
        return new Proxy(collection, {
          get(col, key) {
            const member = Reflect.get(col, key);
            if (key !== 'doc') return typeof member === 'function' ? member.bind(col) : member;
            return (id: string) => {
              const ref = col.doc(id);
              return new Proxy(ref, {
                get(r, k) {
                  if (k === 'set') return () => Promise.reject(new Error('14 UNAVAILABLE: firestore.googleapis.com secret-project-id'));
                  const v = Reflect.get(r, k);
                  return typeof v === 'function' ? v.bind(r) : v;
                },
              });
            };
          },
        });
      };
    },
  }) as Firestore;
  setFirestoreForTesting(failingWrites);

  const res = await add(recipe());
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error, 'The recipe could not be saved. Please try again.');
  assert.doesNotMatch(JSON.stringify(body), /UNAVAILABLE|secret-project-id/);
  assert.equal(fs.list('meals').length, 1);
});
