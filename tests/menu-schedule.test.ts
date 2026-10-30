import './helpers/isolate-env';
import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeFirestore } from './helpers/fake-firestore';
import { jsonRequest, signedInAs, useFakeFirestore } from './helpers/session';
import { setFirestoreForTesting } from '../lib/firebase-admin';
import { validateCartAvailability } from '../lib/availability';
import { GET as publicMenu } from '../app/api/menu/route';
import { GET as adminMenus } from '../app/api/admin/menus/route';
import { GET as adminStats } from '../app/api/admin/stats/route';

let fs: FakeFirestore;

/** Pins "now" to an India-time wall clock, e.g. at('2026-11-01T10:00'). */
const at = (istLocal: string) => mock.timers.enable({ apis: ['Date'], now: new Date(`${istLocal}:00+05:30`) });

function seedMenu(date: string, category: string, mealId: string | null, extra: Record<string, unknown> = {}) {
  const slug = category.toLowerCase().replace(/[^a-z0-9]/g, '_');
  fs.seed('menus', `menu_${date}_${slug}`, {
    id: `menu_${date}_${slug}`, date, studentCategory: category, mealId: mealId || '',
    isHoliday: !mealId, holidayReason: mealId ? null : 'Holiday',
    availableQuantity: mealId ? 50 : 0, maxQuantity: 50, orderingDeadline: '08:30', isActive: Boolean(mealId), ...extra,
  });
}

beforeEach(() => {
  fs = useFakeFirestore();
  fs.seed('meals', 'meal_soya', { id: 'meal_soya', name: 'Soyabean Masala+Dal+Chapati+Salad', price: 80, category: 'LUNCH' });
  fs.seed('meals', 'meal_kofta', { id: 'meal_kofta', name: 'Kofta Curry + Dal + Rice + Chapati + Salad', price: 80, category: 'LUNCH' });
  fs.seed('teacher_meals', 'TM-001', { id: 'TM-001', name: 'Veg Thali', price: 120, isAvailable: true });
  // November published weeks in advance (publication record dated 20 October).
  seedMenu('2026-11-01', 'Primary', null);
  seedMenu('2026-11-02', 'Primary', 'meal_soya');
  seedMenu('2026-11-30', 'Primary', 'meal_kofta');
  seedMenu('2027-01-04', 'Primary', 'meal_soya');
  fs.seed('menu_publishes', '2026-11-02', { date: '2026-11-02', publishedOn: '2026-10-20', selectedMealIds: ['meal_soya'] });
});

afterEach(() => {
  mock.timers.reset();
  setFirestoreForTesting(null);
});

const item = (date: string, mealId = 'meal_soya') => ({ mealId, date, quantity: 1, studentCategory: 'Primary' });
const bookable = async (date: string, mealId?: string) => (await validateCartAvailability([item(date, mealId)])).valid;

test('a menu published weeks ahead stays active and bookable the day before (October to November rollover)', async () => {
  const before = JSON.stringify(fs.list('menus'));
  for (const now of ['2026-10-31T10:00', '2026-11-01T10:00', '2026-11-01T23:59']) {
    at(now);
    const res = await publicMenu(jsonRequest('/api/menu?date=2026-11-02&category=Primary', 'GET'));
    assert.equal(res.status, 200);
    const menus = (await res.json()).menus as any[];
    assert.equal(menus.length, 1, now);
    assert.equal(menus[0].isAvailable, true, `bookable when viewed at ${now}`);
    assert.equal(await bookable('2026-11-02'), true, now);
    mock.timers.reset();
  }
  assert.equal(JSON.stringify(fs.list('menus')), before, 'reading menus never changes them');
});

test('public, staff and dashboard reads never deactivate menus', async () => {
  at('2026-11-01T09:00');
  const staff = await signedInAs(fs, 'STAFF');
  const before = JSON.stringify(fs.list('menus'));
  await publicMenu(jsonRequest('/api/menu', 'GET'));
  await publicMenu(jsonRequest('/api/menu?startDate=2026-11-01&endDate=2026-11-30', 'GET'));
  await adminMenus(jsonRequest('/api/admin/menus', 'GET', undefined, staff));
  await adminMenus(jsonRequest('/api/admin/menus?date=2026-11-02', 'GET', undefined, staff));
  await adminStats(jsonRequest('/api/admin/stats', 'GET', undefined, staff));
  assert.equal(JSON.stringify(fs.list('menus')), before);
  assert.equal(fs.getDoc('teacher_meals', 'TM-001')?.isAvailable, true, 'teacher menu untouched');
});

test('service-date rules: deadline, past dates, holidays and month/year ends', async () => {
  at('2026-11-02T07:00');
  assert.equal(await bookable('2026-11-02'), true, 'before the 08:30 deadline');
  mock.timers.reset();

  at('2026-11-02T08:31');
  assert.equal(await bookable('2026-11-02'), false, 'after the deadline');
  mock.timers.reset();

  at('2026-11-03T07:00');
  assert.equal(await bookable('2026-11-02'), false, 'past date');
  mock.timers.reset();

  at('2026-10-31T12:00');
  assert.equal(await bookable('2026-11-01'), false, 'holiday');
  assert.equal(await bookable('2026-11-30', 'meal_kofta'), true, 'end of month, a month ahead');
  assert.equal(await bookable('2026-11-05'), false, 'no menu entered for that date');
  mock.timers.reset();

  at('2026-12-31T12:00');
  assert.equal(await bookable('2027-01-04'), true, 'across the year end');
});

test('a menu explicitly disabled by staff is not bookable', async () => {
  at('2026-11-01T10:00');
  fs.seed('menus', 'menu_2026-11-02_primary', { ...fs.getDoc('menus', 'menu_2026-11-02_primary'), isActive: false });
  assert.equal(await bookable('2026-11-02'), false);
});

test('the admin menu list requires a staff or admin login', async () => {
  assert.equal((await adminMenus(jsonRequest('/api/admin/menus', 'GET'))).status, 403);
  const parent = await signedInAs(fs, 'PARENT');
  assert.equal((await adminMenus(jsonRequest('/api/admin/menus', 'GET', undefined, parent))).status, 403);
});

test("a child's details on the public menu are only shown to that child's parent", async () => {
  at('2026-11-01T10:00');
  const parent = await signedInAs(fs, 'PARENT', 'usr_p1');
  const other = await signedInAs(fs, 'PARENT', 'usr_p2');
  fs.seed('students', 'stu_1', { id: 'stu_1', parentId: 'par_usr_p1', name: 'Riya', grade: '3', studentCategory: 'Primary', allergies: 'Peanuts', isActive: true });

  const url = '/api/menu?date=2026-11-02&childId=stu_1';
  assert.equal((await publicMenu(jsonRequest(url, 'GET'))).status, 404);
  assert.equal((await publicMenu(jsonRequest(url, 'GET', undefined, other))).status, 404);
  const own = await publicMenu(jsonRequest(url, 'GET', undefined, parent));
  assert.equal(own.status, 200);
});
