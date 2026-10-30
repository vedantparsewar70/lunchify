import './helpers/isolate-env';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeFirestore } from './helpers/fake-firestore';
import { jsonRequest, signedInAs, useFakeFirestore } from './helpers/session';
import { setFirestoreForTesting } from '../lib/firebase-admin';
import { validateCartAvailability } from '../lib/availability';
import { applyMonthlyMenu, type MonthlyMenuPlan } from '../lib/monthly-menu';
import { POST as staffPublish } from '../app/api/admin/menus/assign/route';
import { POST as adminPublish } from '../app/api/admin/menus/publish/route';
import { PATCH as legacyBatchPublish } from '../app/api/admin/menus/route';
import { GET as parentMenu } from '../app/api/menu/route';

/**
 * One menu per date and student category, whichever tool wrote it: Admin → Menu, Staff → Kitchen,
 * the monthly Excel import, and entries left by older admin tools (ID `<mealId>_<date>`).
 */
const DAY = '2099-01-05';
let fs: FakeFirestore;
let staff: Record<string, string>;
let admin: Record<string, string>;

const legacy = (mealId: string, studentCategory: string | null, fields: Record<string, unknown> = {}) => {
  const id = `${mealId}_${DAY}`;
  fs.seed('menus', id, {
    id, mealId, date: DAY, ...(studentCategory ? { studentCategory } : {}), isHoliday: false,
    availableQuantity: 30, maxQuantity: 50, orderingDeadline: '08:30', isActive: true, updatedAt: '2099-01-01T00:00:00Z', ...fields,
  });
  return id;
};

beforeEach(async () => {
  fs = useFakeFirestore();
  staff = await signedInAs(fs, 'STAFF');
  admin = await signedInAs(fs, 'ADMIN');
  for (const [id, name, price] of [['meal_dal', 'Dal Khichdi', 70], ['meal_pulao', 'Veg Pulao', 85], ['meal_poha', 'Poha', 40]] as const) {
    fs.seed('meals', id, { id, name, price, category: 'LUNCH', isVegetarian: true, allergens: null });
  }
});

afterEach(() => setFirestoreForTesting(null));

const viaStaff = (studentCategory: string, mealId: string, replace?: boolean) =>
  staffPublish(jsonRequest('/api/admin/menus/assign', 'POST', { date: DAY, studentCategory, mealId, replace }, staff));
const viaAdmin = (studentCategory: string, selectedMealIds: string[], replace?: boolean) =>
  adminPublish(jsonRequest('/api/admin/menus/publish', 'POST', { date: DAY, studentCategory, selectedMealIds, replace }, admin));
const viaImport = (cells: Partial<Record<'Pre-primary' | 'Primary' | 'Secondary', string>>, replaceUnordered = false) => {
  const cell = (dish?: string) => (dish ? { kind: 'MEAL' as const, dish, merged: false } : { kind: 'BLANK' as const });
  const plan: MonthlyMenuPlan = {
    title: null, month: '2099-01', issues: [],
    days: [{ row: 1, date: DAY, dayLabel: '5', weekday: 'Monday', errors: [], cells: { 'Pre-primary': cell(cells['Pre-primary']), Primary: cell(cells.Primary), Secondary: cell(cells.Secondary) } }],
  };
  return applyMonthlyMenu(plan, { replaceUnordered, actorId: 'usr_staff' });
};
const parentSees = async (category: string) =>
  ((await (await parentMenu(jsonRequest(`/api/menu?date=${DAY}&category=${category}`, 'GET'))).json()).menus as Array<{ id: string; mealId: string; isAvailable: boolean }>)
    .filter((m) => m.isAvailable)
    .map((m) => m.mealId);
const canOrder = async (mealId: string, studentCategory: string) =>
  (await validateCartAvailability([{ mealId, date: DAY, quantity: 1, studentCategory } as never])).valid;
const menu = (id: string) => fs.getDoc('menus', id);

test('staff publishing over an entry left by the old admin tool asks first, then replaces it without deleting it', async () => {
  const old = legacy('meal_dal', 'Primary');

  const ask = await viaStaff('Primary', 'meal_pulao');
  assert.equal(ask.status, 409);
  assert.equal((await ask.json()).code, 'NEEDS_REPLACE');
  assert.equal(menu(`menu_${DAY}_primary`), undefined, 'no second entry was added');
  assert.deepEqual(await parentSees('Primary'), ['meal_dal']);

  assert.equal((await viaStaff('Primary', 'meal_pulao', true)).status, 200);
  assert.equal(menu(`menu_${DAY}_primary`)?.mealId, 'meal_pulao');
  assert.equal(menu(old)?.isActive, false, 'old entry switched off, not deleted');
  assert.equal(menu(old)?.replacedBy, `menu_${DAY}_primary`);
  assert.deepEqual(await parentSees('Primary'), ['meal_pulao'], 'parents see one dish');
  assert.equal(await canOrder('meal_pulao', 'Primary'), true);
  assert.equal(await canOrder('meal_dal', 'Primary'), false);
});

test('an entry with orders is never replaced, from any tool', async () => {
  const old = legacy('meal_dal', 'Primary', { availableQuantity: 29 });
  fs.seed('orderItems', 'oit_1', { id: 'oit_1', orderId: 'ORD-1', mealId: 'meal_dal', menuId: old, date: DAY, quantity: 1, studentCategory: 'Primary' });
  const before = menu(old);

  const staffTry = await viaStaff('Primary', 'meal_pulao', true);
  assert.equal(staffTry.status, 409);
  assert.equal((await staffTry.json()).code, 'HAS_ORDERS');
  assert.equal((await viaAdmin('Primary', ['meal_pulao'], true)).status, 409);
  const imported = await viaImport({ Primary: 'Veg Pulao' }, true);
  assert.equal(imported.days[0].cells.Primary.outcome, 'conflict-has-orders');

  assert.deepEqual(menu(old), before, 'entry, stock and order reference untouched');
  assert.equal(menu(`menu_${DAY}_primary`), undefined);
  assert.deepEqual(await parentSees('Primary'), ['meal_dal']);
});

test("publishing the dish that is already on the menu keeps the existing entry's ID and stock", async () => {
  const old = legacy('meal_dal', 'Primary', { availableQuantity: 17 });
  const res = await viaStaff('Primary', 'meal_dal');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).outcome, 'unchanged');
  assert.equal(menu(old)?.availableQuantity, 17);
  assert.equal(menu(`menu_${DAY}_primary`), undefined, 'no duplicate entry created');
  assert.equal((await viaImport({ Primary: 'Dal Khichdi' })).days[0].cells.Primary.outcome, 'unchanged');
});

test('a dish shared by all categories can only be replaced for all categories at once', async () => {
  const shared = legacy('meal_dal', null);
  for (const cat of ['Pre-primary', 'Primary', 'Secondary']) assert.deepEqual(await parentSees(cat), ['meal_dal']);

  const one = await viaStaff('Primary', 'meal_pulao', true);
  assert.equal(one.status, 409);
  assert.equal((await one.json()).code, 'SHARED_ENTRY');
  assert.equal(menu(shared)?.isActive, true);

  assert.equal((await viaStaff('ALL', 'meal_pulao')).status, 409, 'still asks before replacing');
  assert.equal((await viaStaff('ALL', 'meal_pulao', true)).status, 200);
  assert.equal(menu(shared)?.isActive, false);
  for (const cat of ['Pre-primary', 'Primary', 'Secondary']) {
    assert.deepEqual(await parentSees(cat), ['meal_pulao'], cat);
  }
});

test('an Excel day that retires a shared entry still gives every category its own menu', async () => {
  const shared = legacy('meal_dal', null);
  // Primary keeps the shared dish; the other two categories change.
  const result = await viaImport({ 'Pre-primary': 'Poha', Primary: 'Dal Khichdi', Secondary: 'Veg Pulao' }, true);
  assert.equal(result.written, true);
  assert.equal(menu(shared)?.isActive, false);
  assert.equal(menu(`menu_${DAY}_primary`)?.mealId, 'meal_dal', 'Primary got its own entry for the same dish');
  assert.deepEqual(await parentSees('Pre-primary'), ['meal_poha']);
  assert.deepEqual(await parentSees('Primary'), ['meal_dal']);
  assert.deepEqual(await parentSees('Secondary'), ['meal_pulao']);
});

test('Admin → Menu, Staff → Kitchen and Excel all respect each other', async () => {
  const many = await viaAdmin('Primary', ['meal_dal', 'meal_pulao']);
  assert.equal(many.status, 400);
  assert.equal((await many.json()).code, 'ONE_DISH_PER_DAY');
  assert.equal(fs.list('menus').length, 0);

  assert.equal((await viaStaff('Primary', 'meal_dal')).status, 200);
  const adminTry = await viaAdmin('Primary', ['meal_pulao']);
  assert.equal(adminTry.status, 409);
  assert.equal((await adminTry.json()).code, 'NEEDS_REPLACE');
  assert.equal((await viaAdmin('Primary', ['meal_pulao'], true)).status, 200);
  assert.equal(menu(`menu_${DAY}_primary`)?.mealId, 'meal_pulao');

  const sheet = await viaImport({ Primary: 'Poha' });
  assert.equal(sheet.days[0].cells.Primary.outcome, 'conflict-differs');
  assert.equal(menu(`menu_${DAY}_primary`)?.mealId, 'meal_pulao', 'the sheet did not overwrite it');
  assert.equal(fs.list('menus').length, 1, 'still one entry for the day');

  // The old batch API follows the same rules.
  const batch = await legacyBatchPublish(jsonRequest('/api/admin/menus', 'PATCH', { date: DAY, selectedMealIds: ['meal_dal', 'meal_poha'] }, admin));
  assert.equal(batch.status, 400);
});

test('Admin → Menu with nothing selected stops sales for that category without deleting anything', async () => {
  assert.equal((await viaStaff('Primary', 'meal_dal')).status, 200);
  assert.equal((await viaStaff('Secondary', 'meal_pulao')).status, 200);
  assert.equal((await viaAdmin('Primary', [])).status, 200);
  assert.equal(menu(`menu_${DAY}_primary`)?.isActive, false);
  assert.deepEqual(await parentSees('Primary'), []);
  assert.deepEqual(await parentSees('Secondary'), ['meal_pulao'], 'other categories unchanged');
  assert.equal(fs.list('menus').length, 2);

  // Publishing the same dish again switches the same entry back on, after confirming; stock is kept.
  fs.seed('menus', `menu_${DAY}_primary`, { ...menu(`menu_${DAY}_primary`), availableQuantity: 12 });
  const again = await viaStaff('Primary', 'meal_dal');
  assert.equal(again.status, 409);
  assert.equal((await again.json()).code, 'NEEDS_REPLACE');
  assert.equal((await viaStaff('Primary', 'meal_dal', true)).status, 200);
  assert.equal(menu(`menu_${DAY}_primary`)?.isActive, true);
  assert.equal(menu(`menu_${DAY}_primary`)?.availableQuantity, 12, 'stock kept');
  assert.deepEqual(await parentSees('Primary'), ['meal_dal']);
});

test('duplicates already in the database: parents see one dish, and only that one can be ordered', async () => {
  legacy('meal_dal', 'Primary', { updatedAt: '2099-01-01T00:00:00Z' });
  fs.seed('menus', `menu_${DAY}_primary`, {
    id: `menu_${DAY}_primary`, mealId: 'meal_pulao', date: DAY, studentCategory: 'Primary', isHoliday: false,
    availableQuantity: 50, orderingDeadline: '08:30', isActive: true, updatedAt: '2098-12-01T00:00:00Z',
  });
  legacy('meal_poha', null);

  assert.deepEqual(await parentSees('Primary'), ['meal_pulao'], 'the standard category entry wins');
  assert.equal(await canOrder('meal_pulao', 'Primary'), true);
  assert.equal(await canOrder('meal_dal', 'Primary'), false);
  assert.equal(await canOrder('meal_poha', 'Primary'), false);
  assert.deepEqual(await parentSees('Secondary'), ['meal_poha'], 'the shared entry still serves other categories');
  assert.equal(await canOrder('meal_poha', 'Secondary'), true);
});
