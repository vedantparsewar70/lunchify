import './helpers/isolate-env';
import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeFirestore } from './helpers/fake-firestore';
import { signedInAs, useFakeFirestore } from './helpers/session';
import { buildXlsx, november2026Workbook } from './helpers/xlsx-builder';
import { setFirestoreForTesting } from '../lib/firebase-admin';
import { dishKey, parseMonthlyMenu } from '../lib/monthly-menu';
import { readFirstSheet, XlsxError } from '../lib/xlsx-reader';
import { validateCartAvailability } from '../lib/availability';
import { POST as importMenu } from '../app/api/admin/menus/import/route';

let fs: FakeFirestore;
let staff: Record<string, string>;

beforeEach(async () => {
  fs = useFakeFirestore();
  staff = await signedInAs(fs, 'STAFF');
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-29T12:00:00+05:30') });
});

afterEach(() => {
  mock.timers.reset();
  setFirestoreForTesting(null);
});

const NOVEMBER_DISHES = [
  'Soyabean Masala+Dal+Chapati+Salad', 'Aloo Gobi + Chapati + Lemon Rice + Papad', 'Jeera Rice + Chole Bhaji + Chapati + Salad+Sweet',
  'Chana Masala + Chapati +Jeera Rice +  Salad', 'Green Moong + Dal + Chapati + Rice', 'Aloo Paratha + Pulao + Curd', 'Uttapa+Sambar+Chutney',
  'Bharli Vangi + Pancharatna Dal + Chapati + Rice', 'Paneer butter Masala+Dal+Chapati+Rice', 'Veg Cutlet+Mint Chutney+Banana',
  'Veg Biryani + Raita + Papad(udid roasted)', 'Chawli Usal+Masale Bhat + Chapati + Salad', 'Cabbage Peas subji+ Dal +Rice+Chapati + Salad',
  'Kofta Curry + Dal + Rice + Chapati + Salad',
];

/** Staff decisions for every new dish. Values here are test inputs, not real school prices. */
const allDishDecisions = () =>
  Object.fromEntries(NOVEMBER_DISHES.map((d) => [dishKey(d), { price: 80, isVegetarian: true, noAllergens: true }]));

function upload(action: 'preview' | 'publish', options: Record<string, unknown> = {}, file = november2026Workbook(), headers = staff) {
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(file)]), 'November_2026_Menu.xlsx');
  form.set('action', action);
  form.set('options', JSON.stringify(options));
  return importMenu(new Request('http://localhost:3000/api/admin/menus/import', { method: 'POST', body: form, headers }));
}

test('the November 2026 sheet parses exactly: holidays, merged ranges, category differences, no invented data', () => {
  const plan = parseMonthlyMenu(readFirstSheet(november2026Workbook()));
  assert.equal(plan.month, '2026-11');
  assert.equal(plan.title, 'November 2026 Brunch Menu');
  assert.equal(plan.days.length, 30);
  assert.deepEqual(plan.issues.filter((i) => i.severity === 'error'), []);
  assert.deepEqual(plan.issues.filter((i) => i.severity === 'warning'), [], 'every cell is filled or merged');

  const day = (d: number) => plan.days.find((x) => x.date === `2026-11-${String(d).padStart(2, '0')}`)!;
  const holiday = (d: number) => ['Pre-primary', 'Primary', 'Secondary'].map((c) => (day(d).cells as any)[c]);
  assert.deepEqual(holiday(1).map((c) => c.kind === 'HOLIDAY' && c.reason), ['Holiday', 'Holiday', 'Holiday']);
  for (let d = 5; d <= 16; d++) assert.deepEqual(holiday(d).map((c) => c.reason), ['Diwali Vacation', 'Diwali Vacation', 'Diwali Vacation'], `Nov ${d}`);
  for (const d of [21, 22, 29]) assert.ok(holiday(d).every((c) => c.reason === 'Holiday'), `Nov ${d}`);
  assert.ok(holiday(24).every((c) => c.reason === 'Guru Nanak Jayanti Holiday'));

  assert.equal((day(26).cells['Pre-primary'] as any).dish, 'Veg Cutlet+Mint Chutney+Banana');
  assert.equal((day(26).cells.Primary as any).dish, 'Veg Biryani + Raita + Papad(udid roasted)');
  assert.equal((day(17).cells.Primary as any).dish, 'Chana Masala + Chapati +Jeera Rice +  Salad', 'inner spelling/spacing kept');
  assert.ok(plan.days.every((d) => d.weekday!.toLowerCase().startsWith(d.dayLabel.toLowerCase())), 'weekdays match dates');
});

test('preview lists every new dish as needing a price and allergen decision, and writes nothing', async () => {
  const res = await upload('preview');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.dishes.length, 14);
  assert.ok(body.dishes.every((d: any) => !d.existing && d.price === null && d.problems.includes('Price needed')));
  assert.equal(body.counts.create, 90);
  assert.equal(fs.list('menus').length, 0);
  assert.equal(fs.list('meals').length, 0);
});

test('publishing without prices is refused; with staff decisions it creates the month, idempotently', async () => {
  assert.equal((await upload('publish')).status, 422);
  assert.equal(fs.list('menus').length, 0);

  const res = await upload('publish', { dishes: allDishDecisions() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.written, true);
  assert.equal(fs.list('menus').length, 90);
  assert.equal(fs.list('meals').length, 14);
  assert.equal(fs.list('menu_imports').length, 1, 'audit record');

  const nov1 = fs.getDoc('menus', 'menu_2026-11-01_primary')!;
  assert.equal(nov1.isHoliday, true);
  assert.equal(nov1.holidayReason, 'Holiday');
  assert.equal(nov1.isActive, false);
  assert.equal(fs.getDoc('menus', 'menu_2026-11-10_secondary')!.holidayReason, 'Diwali Vacation');
  const ppMeal = fs.getDoc('meals', fs.getDoc('menus', 'menu_2026-11-26_pre_primary')!.mealId)!;
  const priMeal = fs.getDoc('meals', fs.getDoc('menus', 'menu_2026-11-26_primary')!.mealId)!;
  assert.equal(ppMeal.name, 'Veg Cutlet+Mint Chutney+Banana');
  assert.equal(priMeal.name, 'Veg Biryani + Raita + Papad(udid roasted)');
  assert.equal(fs.getDoc('menus', 'menu_2026-11-26_secondary')!.mealId, priMeal.id, 'same dish -> same meal');

  const check = async (date: string, cat: string, mealId: string) =>
    (await validateCartAvailability([{ mealId, date, quantity: 1, studentCategory: cat } as any])).valid;
  const nov2 = fs.getDoc('menus', 'menu_2026-11-02_primary')!;
  assert.equal(await check('2026-11-02', 'Primary', nov2.mealId), true, 'bookable, published weeks ahead');
  assert.equal(await check('2026-11-01', 'Primary', nov2.mealId), false, 'holiday not bookable');

  // Same file again: nothing changes, nothing duplicated.
  const before = JSON.stringify([fs.list('menus'), fs.list('meals')]);
  const again = await (await upload('publish', { dishes: allDishDecisions() })).json();
  assert.equal(again.counts.unchanged, 90);
  assert.equal(again.counts.create, 0);
  assert.equal(JSON.stringify([fs.list('menus'), fs.list('meals')]), before);
});

test('existing menus are never overwritten silently, and never at all once they have orders', async () => {
  fs.seed('meals', 'meal_old', { id: 'meal_old', name: 'Old Dish', price: 70 });
  fs.seed('menus', 'menu_2026-11-02_primary', { id: 'menu_2026-11-02_primary', date: '2026-11-02', studentCategory: 'Primary', mealId: 'meal_old', isActive: true, availableQuantity: 40 });
  fs.seed('menus', 'menu_2026-11-03_primary', { id: 'menu_2026-11-03_primary', date: '2026-11-03', studentCategory: 'Primary', mealId: 'meal_old', isActive: true, availableQuantity: 50 });
  fs.seed('orderItems', 'oit_1', { id: 'oit_1', orderId: 'ORD-1', mealId: 'meal_old', date: '2026-11-02', menuId: 'menu_2026-11-02_primary', studentCategory: 'Primary' });

  const safe = await (await upload('publish', { dishes: allDishDecisions() })).json();
  assert.equal(safe.counts['conflict-has-orders'], 1);
  assert.equal(safe.counts['conflict-differs'], 1);
  assert.equal(fs.getDoc('menus', 'menu_2026-11-02_primary')!.mealId, 'meal_old');
  assert.equal(fs.getDoc('menus', 'menu_2026-11-03_primary')!.mealId, 'meal_old');

  const replaced = await (await upload('publish', { dishes: allDishDecisions(), replaceUnordered: true })).json();
  assert.equal(replaced.counts.replace, 1);
  assert.equal(fs.getDoc('menus', 'menu_2026-11-02_primary')!.mealId, 'meal_old', 'menu with orders kept');
  assert.equal(fs.getDoc('menus', 'menu_2026-11-02_primary')!.availableQuantity, 40, 'its stock untouched');
  assert.notEqual(fs.getDoc('menus', 'menu_2026-11-03_primary')!.mealId, 'meal_old', 'unordered menu replaced on request');
});

test('bad rows are reported and block publishing; blank cells stay unbookable', async () => {
  const sheet = buildXlsx('Bad', [
    ['Day', 'Date', 'Pre-primary', 'Primary', 'Secondary'],
    ['Tuesday', 46328, 'Dal Rice', 'Dal Rice', 'Dal Rice'], // 2026-11-02 is a Monday
    ['Tuesday', 46329, 'Poha', null, 'Poha'], // blank Primary, not merged
    ['Tuesday', 46329, 'Poha', 'Poha', 'Poha'], // duplicate date
    ['Wednesday', 'not a date', 'Upma', 'Upma', 'Upma'],
  ]);
  const plan = parseMonthlyMenu(readFirstSheet(sheet));
  const errors = plan.issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' | ');
  assert.match(errors, /does not match 2026-11-02, which is a Monday/);
  assert.match(errors, /Duplicate date 2026-11-03/);
  assert.match(errors, /Invalid or missing date/);
  assert.ok(plan.issues.some((i) => i.severity === 'warning' && /Primary has no entry/.test(i.message)));
  assert.ok(plan.issues.some((i) => /2026-11-30 is not listed/.test(i.message)));

  const res = await upload('publish', { dishes: { 'dal rice': { price: 50, isVegetarian: true, noAllergens: true }, poha: { price: 40, isVegetarian: true, noAllergens: true }, upma: { price: 40, isVegetarian: true, noAllergens: true } } }, sheet);
  assert.equal(res.status, 422);
  assert.equal(fs.list('menus').length, 0);
});

test('allergens typed by staff are stored and linked; parents and signed-out users cannot import', async () => {
  const decisions = allDishDecisions();
  decisions[dishKey('Paneer butter Masala+Dal+Chapati+Rice')] = { price: 90, isVegetarian: true, allergens: 'Milk, Wheat' } as any;
  await upload('publish', { dishes: decisions });
  const paneer = fs.list('meals').find((m) => m.name === 'Paneer butter Masala+Dal+Chapati+Rice')!;
  assert.equal(paneer.allergens, 'Milk, Wheat');
  assert.equal(paneer.price, 90);
  assert.equal(fs.list('mealAllergens').filter((l) => l.mealId === paneer.id).length, 2);

  const parent = await signedInAs(fs, 'PARENT');
  assert.equal((await upload('preview', {}, november2026Workbook(), parent)).status, 403);
  assert.equal((await upload('preview', {}, november2026Workbook(), {})).status, 403);
});

test('non-spreadsheet uploads are rejected safely', async () => {
  assert.throws(() => readFirstSheet(Buffer.from('hello world, definitely not a zip file')), XlsxError);
  const res = await upload('preview', {}, Buffer.from('PK not really'));
  assert.equal(res.status, 400);
});

test('the monthly import never touches the Teachers Only menu', async () => {
  fs.seed('teacher_meals', 'TM-001', { id: 'TM-001', name: 'Veg Thali', price: 120, isAvailable: true });
  await upload('publish', { dishes: allDishDecisions() });
  assert.deepEqual(fs.list('teacher_meals'), [{ id: 'TM-001', name: 'Veg Thali', price: 120, isAvailable: true }]);
});
