import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mondayOf, addDays, weekLabel, newPlan, setMeal, usageCount, filledCount,
  hints, eggDayCount, encodePlan, decodePlan, isValidPlan, SLOT_KEYS,
} from '../planner.js';

const data = JSON.parse(readFileSync(new URL('../data/meals.json', import.meta.url), 'utf8'));
const byId = new Map(data.meals.map((m) => [m.id, m]));

test('meals.json integrity', () => {
  const ids = new Set();
  for (const m of data.meals) {
    assert.ok(!ids.has(m.id), `duplicate id ${m.id}`);
    ids.add(m.id);
    assert.ok(SLOT_KEYS.includes(m.slot), `${m.id} bad slot`);
    const cats = data.categories[m.slot].map((c) => c.key);
    assert.ok(cats.includes(m.category), `${m.id} bad category ${m.category}`);
    assert.ok(m.title && m.lines.length > 0, `${m.id} missing title/lines`);
    const prefix = data.slots.find((s) => s.key === m.slot).prefix;
    assert.ok(m.id.startsWith(prefix), `${m.id} prefix should be ${prefix}`);
  }
  // every category has at least one meal
  for (const slot of SLOT_KEYS) {
    for (const c of data.categories[slot]) {
      const n = data.meals.filter((m) => m.slot === slot && m.category === c.key).length;
      assert.ok(n >= 1, `${slot}/${c.key} empty`);
    }
  }
});

test('mondayOf snaps to Monday', () => {
  assert.equal(mondayOf('2026-08-24'), '2026-08-24'); // Monday
  assert.equal(mondayOf('2026-08-27'), '2026-08-24'); // Thursday
  assert.equal(mondayOf('2026-08-30'), '2026-08-24'); // Sunday
  assert.equal(mondayOf('2026-08-31'), '2026-08-31');
});

test('addDays and weekLabel', () => {
  assert.equal(addDays('2026-08-24', 6), '2026-08-30');
  assert.equal(addDays('2026-12-29', 6), '2027-01-04');
  assert.equal(weekLabel('2026-08-24'), '24/8 - 30/8/2026');
});

test('newPlan + setMeal is immutable and counts', () => {
  const p0 = newPlan('2026-08-26');
  assert.equal(p0.weekStart, '2026-08-24');
  assert.equal(filledCount(p0), 0);
  const p1 = setMeal(p0, 0, 'kahvalti', 'K1');
  assert.equal(p0.days[0].kahvalti, null);
  assert.equal(p1.days[0].kahvalti, 'K1');
  const p2 = setMeal(p1, 3, 'kahvalti', 'K1');
  assert.equal(usageCount(p2, 'K1'), 2);
  assert.equal(filledCount(p2), 2);
  assert.ok(isValidPlan(p2));
});

test('hint: maxPerWeek exceeded', () => {
  let p = newPlan('2026-08-24');
  p = setMeal(p, 0, 'kahvalti', 'K4');
  p = setMeal(p, 1, 'kahvalti', 'K4');
  assert.equal(hints(p, byId).filter((h) => h.level === 'warn').length, 0);
  p = setMeal(p, 2, 'kahvalti', 'K4');
  const warns = hints(p, byId).filter((h) => h.level === 'warn');
  assert.equal(warns.length, 1);
  assert.equal(warns[0].mealId, 'K4');
  assert.match(warns[0].text, /en fazla 2/);
});

test('hint: egg days only when all breakfasts filled', () => {
  let p = newPlan('2026-08-24');
  for (let i = 0; i < 6; i++) p = setMeal(p, i, 'kahvalti', 'K7'); // bowl, no egg
  assert.equal(hints(p, byId).some((h) => /Yumurtalı/.test(h.text)), false);
  p = setMeal(p, 6, 'kahvalti', 'K1');
  assert.equal(eggDayCount(p, byId), 1);
  assert.equal(hints(p, byId).some((h) => /Yumurtalı kahvaltı 1 gün/.test(h.text)), true);
  for (let i = 0; i < 4; i++) p = setMeal(p, i, 'kahvalti', 'K1');
  assert.equal(hints(p, byId).some((h) => /Yumurtalı/.test(h.text)), false);
});

test('hint: sandwich snack on non-bowl day', () => {
  let p = newPlan('2026-08-24');
  p = setMeal(p, 2, 'ara1', 'T18');
  assert.equal(hints(p, byId).length, 0, 'no breakfast yet, no hint');
  p = setMeal(p, 2, 'kahvalti', 'K1');
  const h = hints(p, byId);
  assert.equal(h.length, 1);
  assert.equal(h[0].dayIdx, 2);
  assert.equal(h[0].slot, 'ara1');
  p = setMeal(p, 2, 'kahvalti', 'K8');
  assert.equal(hints(p, byId).length, 0);
});

test('hint: dinner variety', () => {
  let p = newPlan('2026-08-24');
  p = setMeal(p, 0, 'aksam', 'D1');
  p = setMeal(p, 1, 'aksam', 'D1');
  assert.equal(hints(p, byId).length, 0);
  p = setMeal(p, 2, 'aksam', 'D1');
  assert.ok(hints(p, byId).some((h) => /çeşitlendir/.test(h.text)));
});

test('encode/decode round trip', () => {
  let p = newPlan('2026-08-24');
  p = setMeal(p, 0, 'kahvalti', 'K10');
  p = setMeal(p, 6, 'ara2', 'L9');
  p = setMeal(p, 3, 'aksam', 'D22');
  const s = encodePlan(p);
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodePlan(s), p);
  assert.equal(decodePlan('garbage!!'), null);
  assert.equal(decodePlan(''), null);
});
