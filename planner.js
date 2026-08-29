// Pure planning logic. No DOM, no storage. Used by app.js and tests.

export const SLOT_KEYS = ['kahvalti', 'ara1', 'aksam', 'ara2'];
export const DAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
export const DAY_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

/** Weekday name for the i-th day of a plan that starts on weekStart (any weekday). */
export function dayName(weekStart, i) {
  return DAY_NAMES[(parseISODate(weekStart).getDay() + 6 + i) % 7];
}
export function dayShort(weekStart, i) {
  return DAY_SHORT[(parseISODate(weekStart).getDay() + 6 + i) % 7];
}

const MIN_EGG_DAYS = 4;
const VARIETY_LIMIT = 3;

// ---------- dates ----------

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Snap any ISO date to the Monday of its week. */
export function mondayOf(iso) {
  const d = parseISODate(iso);
  const dow = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setDate(d.getDate() - dow);
  return toISODate(d);
}

export function addDays(iso, n) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** "24/8" style short date. */
export function shortDate(iso) {
  const d = parseISODate(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

/** "24/8 - 30/8/2026" */
export function weekLabel(weekStart) {
  const end = parseISODate(addDays(weekStart, 6));
  return `${shortDate(weekStart)} - ${shortDate(addDays(weekStart, 6))}/${end.getFullYear()}`;
}

// ---------- plan model ----------

export function emptyDay() {
  return { kahvalti: null, ara1: null, aksam: null, ara2: null };
}

export function newPlan(weekStart) {
  return { weekStart, days: Array.from({ length: 7 }, emptyDay) };
}

export function setMeal(plan, dayIdx, slot, id) {
  const days = plan.days.map((d, i) => (i === dayIdx ? { ...d, [slot]: id } : d));
  return { ...plan, days };
}

export function clearPlan(plan) {
  return newPlan(plan.weekStart);
}

/** Same meals, shifted to a new week start (any weekday). */
export function withWeekStart(plan, weekStart) {
  return { ...plan, weekStart };
}

export function usageCount(plan, id) {
  let n = 0;
  for (const d of plan.days) for (const s of SLOT_KEYS) if (d[s] === id) n++;
  return n;
}

export function filledCount(plan) {
  let n = 0;
  for (const d of plan.days) for (const s of SLOT_KEYS) if (d[s]) n++;
  return n;
}

export function isValidPlan(p) {
  return (
    p && typeof p.weekStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.weekStart) &&
    Array.isArray(p.days) && p.days.length === 7 &&
    p.days.every((d) => d && typeof d === 'object' && SLOT_KEYS.every((s) => d[s] === null || typeof d[s] === 'string'))
  );
}

// ---------- hints ----------

/**
 * Returns an array of { level: 'warn'|'info', dayIdx?, slot?, mealId?, text }.
 * mealsById: Map or object id -> meal.
 */
export function hints(plan, mealsById) {
  const get = (id) => (id == null ? null : mealsById instanceof Map ? mealsById.get(id) : mealsById[id]);
  const out = [];

  // 1. per-meal weekly maximum
  const counts = new Map();
  plan.days.forEach((d, dayIdx) => {
    for (const s of SLOT_KEYS) {
      const id = d[s];
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  });
  for (const [id, n] of counts) {
    const m = get(id);
    if (m && m.maxPerWeek && n > m.maxPerWeek) {
      out.push({ level: 'warn', mealId: id, text: `${id} ${m.title}: haftada en fazla ${m.maxPerWeek} kere (${n} kere planlandı)` });
    }
  }

  // 2. egg breakfasts at least MIN_EGG_DAYS, evaluated when all breakfasts are set
  const breakfasts = plan.days.map((d) => get(d.kahvalti));
  if (breakfasts.every(Boolean)) {
    const eggDays = breakfasts.filter((m) => (m.tags || []).includes('egg')).length;
    if (eggDays < MIN_EGG_DAYS) {
      out.push({ level: 'info', text: `Yumurtalı kahvaltı ${eggDays} gün, en az ${MIN_EGG_DAYS} gün olmalı` });
    }
  }

  // 3. sandwich snack only on bowl breakfast days
  plan.days.forEach((d, dayIdx) => {
    const snack = get(d.ara1);
    if (!snack || !(snack.tags || []).includes('sandwichSnack')) return;
    const bf = get(d.kahvalti);
    if (bf && !(bf.tags || []).includes('bowl')) {
      out.push({ level: 'info', dayIdx, slot: 'ara1', mealId: snack.id, text: `${dayName(plan.weekStart, dayIdx)}: sandviç ara öğünü bowl yapılan günler için` });
    }
  });

  // 4. variety: same dinner VARIETY_LIMIT+ times
  const dinnerCounts = new Map();
  for (const d of plan.days) if (d.aksam) dinnerCounts.set(d.aksam, (dinnerCounts.get(d.aksam) || 0) + 1);
  for (const [id, n] of dinnerCounts) {
    if (n >= VARIETY_LIMIT) {
      const m = get(id);
      out.push({ level: 'info', mealId: id, text: `${id} ${m ? m.title : ''} ${n} kere: biraz çeşitlendir` });
    }
  }

  return out;
}

export function eggDayCount(plan, mealsById) {
  const get = (id) => (id == null ? null : mealsById instanceof Map ? mealsById.get(id) : mealsById[id]);
  return plan.days.filter((d) => {
    const m = get(d.kahvalti);
    return m && (m.tags || []).includes('egg');
  }).length;
}

// ---------- randomize ----------

/**
 * Fill every slot with a random meal while respecting the rules that `hints` checks:
 * maxPerWeek, at least MIN_EGG_DAYS egg breakfasts, sandwich snacks only on bowl days,
 * no dinner VARIETY_LIMIT or more times. `rnd` is injectable for tests.
 */
export function randomizePlan(plan, meals, rnd = Math.random) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const has = (m, t) => (m.tags || []).includes(t);
  const bySlot = (s) => meals.filter((m) => m.slot === s);
  const counts = new Map();
  const canUse = (m) => !m.maxPerWeek || (counts.get(m.id) || 0) < m.maxPerWeek;
  const use = (m) => { counts.set(m.id, (counts.get(m.id) || 0) + 1); return m.id; };

  const days = Array.from({ length: 7 }, emptyDay);

  // breakfasts: MIN_EGG_DAYS random days get an egg breakfast, the rest anything
  const eggDays = new Set(shuffle([0, 1, 2, 3, 4, 5, 6]).slice(0, MIN_EGG_DAYS));
  const bf = bySlot('kahvalti');
  days.forEach((d, i) => {
    const pool = bf.filter((m) => canUse(m) && (eggDays.has(i) ? has(m, 'egg') : true));
    d.kahvalti = use(pick(pool.length ? pool : bf));
  });

  // snacks: sandwich snack only on bowl breakfast days
  const sn = bySlot('ara1');
  days.forEach((d) => {
    const bowl = has(meals.find((m) => m.id === d.kahvalti), 'bowl');
    const pool = sn.filter((m) => canUse(m) && (bowl || !has(m, 'sandwichSnack')));
    d.ara1 = use(pick(pool.length ? pool : sn));
  });

  // dinners: no dinner VARIETY_LIMIT or more times
  const dn = bySlot('aksam');
  days.forEach((d) => {
    const pool = dn.filter((m) => canUse(m) && (counts.get(m.id) || 0) < VARIETY_LIMIT - 1);
    d.aksam = use(pick(pool.length ? pool : dn));
  });

  const ev = bySlot('ara2');
  days.forEach((d) => {
    const pool = ev.filter(canUse);
    d.ara2 = use(pick(pool.length ? pool : ev));
  });

  return { ...plan, days };
}

// ---------- share link ----------

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Compact form: weekStart + 28 ids joined by ",", empty = "". */
export function encodePlan(plan) {
  const ids = plan.days.flatMap((d) => SLOT_KEYS.map((s) => d[s] || ''));
  return b64urlEncode(plan.weekStart + '|' + ids.join(','));
}

export function decodePlan(str) {
  try {
    const raw = b64urlDecode(str);
    const [weekStart, idsStr] = raw.split('|');
    const ids = idsStr.split(',');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || ids.length !== 28) return null;
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = emptyDay();
      SLOT_KEYS.forEach((s, j) => { d[s] = ids[i * 4 + j] || null; });
      days.push(d);
    }
    const plan = { weekStart, days };
    return isValidPlan(plan) ? plan : null;
  } catch {
    return null;
  }
}
