import './helpers/isolate-env';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeFirestore } from './helpers/fake-firestore';
import { jsonRequest, signedInAs, useFakeFirestore } from './helpers/session';
import { setFirestoreForTesting } from '../lib/firebase-admin';
import { validateCartAvailability } from '../lib/availability';
import { POST as addRecipe } from '../app/api/admin/meals/route';
import { POST as assign } from '../app/api/admin/menus/assign/route';
import { GET as parentMenu } from '../app/api/menu/route';

const DAY = '2099-01-05';
let fs: FakeFirestore;
let staff: Record<string, string>;

beforeEach(async () => {
  fs = useFakeFirestore();
  staff = await signedInAs(fs, 'STAFF');
  // An existing timetable day: Secondary already has a dish with an order.
  fs.seed('meals', 'meal_dal', { id: 'meal_dal', name: 'Dal Khichdi', category: 'LUNCH', price: 70, isVegetarian: true, allergens: null });
  fs.seed('menus', `menu_${DAY}_secondary`, {
    id: `menu_${DAY}_secondary`, date: DAY, studentCategory: 'Secondary', mealId: 'meal_dal', isHoliday: false,
    availableQuantity: 39, maxQuantity: 50, orderingDeadline: '08:30', isActive: true,
  });
  fs.seed('orderItems', 'oit_1', { id: 'oit_1', orderId: 'ORD-1', mealId: 'meal_dal', menuId: `menu_${DAY}_secondary`, date: DAY, quantity: 1, studentCategory: 'Secondary' });
});

afterEach(() => setFirestoreForTesting(null));

const newRecipe = async (name = 'Veg Pulao + Raita', price = 85) => {
  const res = await addRecipe(jsonRequest('/api/admin/meals', 'POST', { name, category: 'LUNCH', price, isVegetarian: true }, staff));
  assert.equal(res.status, 201);
  return (await res.json()).meal.id as string;
};
const publish = (body: Record<string, unknown>, headers = staff) => assign(jsonRequest('/api/admin/menus/assign', 'POST', body, headers));
const parentSees = async (category: string) =>
  (await (await parentMenu(jsonRequest(`/api/menu?date=${DAY}&category=${category}`, 'GET'))).json()).menus as Array<{ mealId: string; isAvailable: boolean; meal: { name: string; price: number } }>;

test('a new catalog recipe is not on sale until staff publish it for a date; then parents can see and order it', async () => {
  const mealId = await newRecipe();
  assert.deepEqual(await parentSees('Primary'), [], 'adding a recipe does not publish it');

  const res = await publish({ date: DAY, studentCategory: 'Primary', mealId });
  assert.equal(res.status, 200);
  assert.match((await res.json()).message, /Veg Pulao \+ Raita is now on the menu for Primary/);

  const menu = fs.getDoc('menus', `menu_${DAY}_primary`)!;
  assert.equal(menu.mealId, mealId, 'the recipe keeps its own ID');
  assert.equal(menu.isActive, true);
  assert.equal(menu.availableQuantity, 50);
  assert.equal(fs.list('meals').length, 2, 'no duplicate recipe created');
  assert.equal(fs.getDoc('meals', mealId)?.price, 85, 'catalog price untouched');

  const seen = await parentSees('Primary');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].mealId, mealId);
  assert.equal(seen[0].isAvailable, true);
  assert.equal(seen[0].meal.price, 85);

  const cart = await validateCartAvailability([{ mealId, date: DAY, quantity: 1, studentCategory: 'Primary' } as never]);
  assert.equal(cart.valid, true, 'checkout accepts it');
});

test('publishing one category leaves other categories, existing orders and stock untouched', async () => {
  const mealId = await newRecipe();
  const before = fs.getDoc('menus', `menu_${DAY}_secondary`);
  assert.equal((await publish({ date: DAY, studentCategory: 'Pre-primary', mealId })).status, 200);
  assert.deepEqual(fs.getDoc('menus', `menu_${DAY}_secondary`), before);
  assert.equal(fs.getDoc('menus', `menu_${DAY}_primary`), undefined);
  assert.equal(fs.list('orderItems').length, 1);
});

test('a menu with orders is never changed; a different menu without orders is replaced only after confirmation', async () => {
  const mealId = await newRecipe();
  const withOrders = await publish({ date: DAY, studentCategory: 'Secondary', mealId, replace: true });
  assert.equal(withOrders.status, 409);
  assert.equal((await withOrders.json()).code, 'HAS_ORDERS');
  assert.equal(fs.getDoc('menus', `menu_${DAY}_secondary`)?.mealId, 'meal_dal');

  fs.seed('menus', `menu_${DAY}_primary`, {
    id: `menu_${DAY}_primary`, date: DAY, studentCategory: 'Primary', mealId: 'meal_dal', isHoliday: false,
    availableQuantity: 50, maxQuantity: 50, orderingDeadline: '08:30', isActive: true,
  });
  const ask = await publish({ date: DAY, studentCategory: 'Primary', mealId });
  assert.equal(ask.status, 409);
  const body = await ask.json();
  assert.equal(body.code, 'NEEDS_REPLACE');
  assert.equal(body.existingMealName, 'Dal Khichdi');
  assert.equal(fs.getDoc('menus', `menu_${DAY}_primary`)?.mealId, 'meal_dal', 'nothing changed before confirming');

  assert.equal((await publish({ date: DAY, studentCategory: 'Primary', mealId, replace: true })).status, 200);
  assert.equal(fs.getDoc('menus', `menu_${DAY}_primary`)?.mealId, mealId);
  assert.equal((await (await publish({ date: DAY, studentCategory: 'Primary', mealId })).json()).outcome, 'unchanged', 'publishing again is harmless');
});

test('invalid requests, past dates, unknown recipes and non-staff users are refused without changes', async () => {
  const mealId = await newRecipe();
  const parent = await signedInAs(fs, 'PARENT');
  const menusBefore = fs.list('menus').length;
  const cases: Array<[Record<string, unknown>, Record<string, string>, number]> = [
    [{ date: DAY, studentCategory: 'Primary', mealId }, {}, 403],
    [{ date: DAY, studentCategory: 'Primary', mealId }, parent, 403],
    [{ date: '2020-01-06', studentCategory: 'Primary', mealId }, staff, 400],
    [{ date: 'tomorrow', studentCategory: 'Primary', mealId }, staff, 400],
    [{ date: DAY, studentCategory: 'Teachers', mealId }, staff, 400],
    [{ date: DAY, studentCategory: 'Primary' }, staff, 400],
    [{ date: DAY, studentCategory: 'Primary', mealId: 'meal_missing' }, staff, 404],
  ];
  for (const [body, headers, status] of cases) {
    assert.equal((await publish(body, headers)).status, status, JSON.stringify(body));
  }
  assert.equal(fs.list('menus').length, menusBefore);
});

test('if two catalog recipes share a name, the chosen one is never swapped for the other', async () => {
  const mealId = await newRecipe('Paneer Roll');
  fs.seed('meals', 'meal_paneer_old', { id: 'meal_paneer_old', name: 'paneer  roll', category: 'LUNCH', price: 60, isVegetarian: true });
  const res = await publish({ date: DAY, studentCategory: 'Primary', mealId: 'meal_paneer_old' });
  const other = await publish({ date: DAY, studentCategory: 'Primary', mealId });
  const statuses = [res.status, other.status].sort();
  assert.deepEqual(statuses, [200, 409], 'only the recipe the name resolves to can be published; the other is refused');
  const published = fs.getDoc('menus', `menu_${DAY}_primary`)?.mealId;
  assert.ok(published === mealId || published === 'meal_paneer_old');
});

test('publishing for a chosen date affects only that date; it creates no order, payment or stock change', async () => {
  const LATER = '2099-01-07';
  const mealId = await newRecipe();
  const menusBefore = fs.list('menus').map((m) => ({ ...m }));

  assert.equal((await publish({ date: LATER, studentCategory: 'Primary', mealId })).status, 200);

  const later = (await (await parentMenu(jsonRequest(`/api/menu?date=${LATER}&category=Primary`, 'GET'))).json()).menus;
  assert.deepEqual(later.map((m: { mealId: string }) => m.mealId), [mealId], 'on sale on the chosen date');
  assert.deepEqual(await parentSees('Primary'), [], `${DAY} is unchanged`);
  for (const m of menusBefore) assert.deepEqual(fs.getDoc('menus', m.id), m, 'existing entries untouched');

  assert.equal(fs.list('orders').length, 0, 'no order is created');
  assert.equal(fs.list('payments').length, 0);
  assert.equal(fs.list('orderItems').length, 1, 'only the order that already existed');
  assert.equal(fs.getDoc('menus', `menu_${LATER}_primary`)?.availableQuantity, 50);

  const past = await publish({ date: '2020-03-02', studentCategory: 'Primary', mealId });
  assert.equal(past.status, 400);
  assert.match((await past.json()).error, /already passed/);
});
