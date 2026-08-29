import {
  SLOT_KEYS, dayName, dayShort, toISODate, addDays, shortDate, weekLabel,
  newPlan, setMeal, clearPlan, withWeekStart, usageCount, filledCount, isValidPlan,
  hints, eggDayCount, encodePlan, decodePlan, randomizePlan,
} from './planner.js';

const VERSION = '1'; // bump when data/*.json changes, busts the fetch cache
const LS_PLAN = 'mealplanner.plan';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

let data, rules, byId;
let plan;
let chip = {}; // slot -> category key or 'all'
let browseSlot = 'kahvalti'; // recipes view: active slot tab
let openMeal = null; // expanded meal card id
let menuOpen = false;

// ---------- storage ----------

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
}
function setPlan(p) {
  plan = p;
  save(LS_PLAN, plan);
}

// ---------- helpers ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slotMeta = (key) => data.slots.find((s) => s.key === key);

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

function route() {
  const h = location.hash || '#/';
  let m;
  if ((m = h.match(/^#\/day\/(\d)\/(kahvalti|ara1|aksam|ara2)$/))) return { view: 'day', dayIdx: +m[1], slot: m[2] };
  if ((m = h.match(/^#\/recipe\/([A-Z]\d+)$/))) return { view: 'recipe', id: m[1] };
  if (h === '#/recipes') return { view: 'recipes' };
  return { view: 'home' };
}

// ---------- views ----------

function render() {
  const r = route();
  if (r.view === 'day') renderDay(r.dayIdx, r.slot);
  else if (r.view === 'recipe') renderRecipe(r.id);
  else if (r.view === 'recipes') renderRecipes();
  else renderHome();
  window.scrollTo(0, 0);
}

function renderHome() {
  const hs = hints(plan, byId);
  const eggs = eggDayCount(plan, byId);
  const filled = filledCount(plan);
  const warnCount = hs.filter((h) => h.level === 'warn').length;

  const days = plan.days.map((d, i) => {
    const date = addDays(plan.weekStart, i);
    const n = SLOT_KEYS.filter((s) => d[s]).length;
    const lines = SLOT_KEYS.map((s) => {
      const m = d[s] ? byId.get(d[s]) : null;
      return `<span><b>${esc(slotMeta(s).short)}</b>${m ? esc(m.title) : '<span class="empty">—</span>'}</span>`;
    }).join('');
    const dots = SLOT_KEYS.map((s) => `<i class="${d[s] ? 'on' : ''}"></i>`).join('');
    return `<button class="day ${n === 4 ? 'done' : ''}" data-day="${i}">
      <div><div class="dn">${esc(dayShort(plan.weekStart, i))}</div><div class="dd">${esc(shortDate(date))}</div></div>
      <div class="lines">${lines}</div>
      <div class="dots">${dots}</div>
    </button>`;
  }).join('');

  app.innerHTML = `
    <header class="top">
      <h1>Haftalık Menü<span class="sub">${esc(rules.subtitle || "")}</span></h1>
      <label class="datebtn">${esc(weekLabel(plan.weekStart))}<input type="date" id="week" value="${plan.weekStart}"></label>
    </header>
    <main>
      <div class="summary">
        <span class="pill ${filled === 28 ? 'ok' : ''}">${filled}/28 öğün</span>
        <span class="pill ${eggs >= 4 ? 'ok' : ''}">🥚 ${eggs}/4 gün</span>
        ${warnCount ? `<span class="pill warn">⚠ ${warnCount} uyarı</span>` : ''}
      </div>
      <div class="days">${days}</div>
      ${hs.length ? `<div class="hints">${hs.map((h) => `<div class="hint ${h.level}">${esc(h.text)}</div>`).join('')}</div>` : ''}
    </main>
    <div class="bar">
      ${tabs('plan')}
      <button class="btn primary" id="pdf" ${filled === 0 ? 'disabled' : ''}>⬇︎ PDF</button>
      <button class="btn" id="share" ${filled === 0 ? 'disabled' : ''}>Paylaş</button>
      <button class="btn icon" id="more" aria-label="Menü">⋯</button>
    </div>
    ${menuOpen ? `<div class="scrim" id="scrim"></div><div class="menu">
      <button id="random">🎲 Rastgele doldur</button>
      <button id="clear" class="danger">Haftayı temizle</button>
    </div>` : ''}
  `;
  bindTabs();

  app.querySelectorAll('.day').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.day;
    const d = plan.days[i];
    const first = SLOT_KEYS.find((s) => !d[s]) || 'kahvalti';
    location.hash = `#/day/${i}/${first}`;
  }));
  app.querySelector('#week').addEventListener('change', (e) => {
    if (!e.target.value) return;
    setPlan(withWeekStart(plan, e.target.value));
    render();
  });
  app.querySelector('#pdf').addEventListener('click', onPdf);
  app.querySelector('#share').addEventListener('click', onShare);
  app.querySelector('#more').addEventListener('click', () => { menuOpen = !menuOpen; render(); });
  app.querySelector('#scrim')?.addEventListener('click', () => { menuOpen = false; render(); });
  app.querySelector('#random')?.addEventListener('click', () => {
    if (filledCount(plan) === 0 || confirm('Mevcut öğünler rastgele yenileriyle değiştirilsin mi?')) {
      setPlan(randomizePlan(plan, data.meals));
      toast('Hafta rastgele dolduruldu');
    }
    menuOpen = false; render();
  });
  app.querySelector('#clear')?.addEventListener('click', () => {
    if (confirm('Bu haftanın tüm öğünleri silinsin mi?')) setPlan(clearPlan(plan));
    menuOpen = false; render();
  });
}

// ---------- shared: bottom tabs + meal card ----------

function tabs(active) {
  return `<nav class="tabs">
    <button class="tab ${active === 'plan' ? 'on' : ''}" data-go="#/">📅<span>Plan</span></button>
    <button class="tab ${active === 'recipes' ? 'on' : ''}" data-go="#/recipes">📖<span>Tarifler</span></button>
  </nav>`;
}
function bindTabs() {
  app.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.go; }));
}

/** Meal card markup shared by the day wizard and the recipe browser. */
function mealCard(m, { selected = false, use = '', hint = null } = {}) {
  const isOpen = openMeal === m.id;
  const lines = m.lines.map((l, i) => `<li class="${i >= 2 && !isOpen ? 'hidden' : ''}">${esc(l)}</li>`).join('');
  const more = m.lines.length > 2 && !isOpen ? `<li class="more" data-more="${m.id}">+${m.lines.length - 2} satır daha</li>` : '';
  return `<button class="meal ${selected ? 'sel' : ''} ${isOpen ? 'open' : ''}" data-id="${m.id}">
    <div class="head"><span class="id">${esc(m.id)}</span><span class="title">${esc(m.title)}</span>${use}</div>
    ${m.recipe ? `<span class="tarif" data-recipe="${m.id}">Tarif</span>` : '<span></span>'}
    <ul class="desc">${lines}${more}</ul>
    ${hint ? `<div class="desc" style="color:var(--amber)">⚠ ${esc(hint.text)}</div>` : ''}
  </button>`;
}

function renderRecipes() {
  const cats = data.categories[browseSlot];
  const cur = chip['browse:' + browseSlot] || 'all';
  const list = data.meals.filter((m) => m.slot === browseSlot && (cur === 'all' || m.category === cur));

  const slotTabs = SLOT_KEYS.map((s) => {
    const sm = slotMeta(s);
    const n = data.meals.filter((m) => m.slot === s).length;
    return `<button class="step ${s === browseSlot ? 'cur' : ''}" data-slot="${s}"><span>${esc(sm.short)}</span><span class="t">${n} seçenek</span></button>`;
  }).join('');
  const chips = [`<button class="chip ${cur === 'all' ? 'on' : ''}" data-cat="all">Hepsi</button>`]
    .concat(cats.map((c) => `<button class="chip ${cur === c.key ? 'on' : ''}" data-cat="${c.key}">${esc(c.label)}</button>`)).join('');

  app.innerHTML = `
    <header class="top">
      <h1>Tarifler<span class="sub">${data.meals.length} öğün · ${esc(slotMeta(browseSlot).label)} ${esc(slotMeta(browseSlot).time)}</span></h1>
    </header>
    <main>
      <div class="steps">${slotTabs}</div>
      <div class="chips">${chips}</div>
      <div class="meals">${list.map((m) => mealCard(m)).join('') || '<p class="empty-list">Bu kategoride öğün yok</p>'}</div>
    </main>
    <div class="bar bar-tabs">${tabs('recipes')}</div>
  `;
  bindTabs();
  app.querySelectorAll('.step').forEach((b) => b.addEventListener('click', () => { browseSlot = b.dataset.slot; openMeal = null; render(); }));
  app.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { chip['browse:' + browseSlot] = b.dataset.cat; render(); }));
  app.querySelectorAll('.meal').forEach((b) => b.addEventListener('click', (e) => {
    const t = e.target.closest('[data-recipe]');
    if (t) { location.hash = `#/recipe/${t.dataset.recipe}`; return; }
    const y = window.scrollY;
    openMeal = openMeal === b.dataset.id ? null : b.dataset.id;
    render();
    window.scrollTo(0, y);
  }));
}

function renderDay(dayIdx, slot) {
  const d = plan.days[dayIdx];
  const meta = slotMeta(slot);
  const cats = data.categories[slot];
  const cur = chip[slot] || 'all';
  const list = data.meals.filter((m) => m.slot === slot && (cur === 'all' || m.category === cur));
  const hs = hints(plan, byId);
  const selected = d[slot];
  const selMeal = selected ? byId.get(selected) : null;

  const steps = SLOT_KEYS.map((s) => {
    const sm = slotMeta(s);
    return `<button class="step ${s === slot ? 'cur' : ''} ${d[s] ? 'set' : ''}" data-slot="${s}">
      <span>${esc(sm.short)} ${d[s] ? '<span class="chk">✓</span>' : ''}</span><span class="t">${esc(sm.time)}</span>
    </button>`;
  }).join('');

  const chips = [`<button class="chip ${cur === 'all' ? 'on' : ''}" data-cat="all">Hepsi</button>`]
    .concat(cats.map((c) => `<button class="chip ${cur === c.key ? 'on' : ''}" data-cat="${c.key}">${esc(c.label)}</button>`)).join('');

  const cards = list.map((m) => {
    const n = usageCount(plan, m.id);
    let use = '';
    if (m.maxPerWeek) use = `<span class="use ${n > m.maxPerWeek ? 'over' : ''}">${n}/${m.maxPerWeek}</span>`;
    else if (n > 0) use = `<span class="use info">${n}×</span>`;
    const hint = hs.find((h) => h.mealId === m.id && (h.dayIdx === undefined || h.dayIdx === dayIdx));
    return mealCard(m, { selected: selected === m.id, use, hint });
  }).join('');

  app.innerHTML = `
    <header class="top">
      <button class="back" id="back" aria-label="Geri">‹</button>
      <h1>${esc(dayName(plan.weekStart, dayIdx))} <span class="sub">${esc(shortDate(addDays(plan.weekStart, dayIdx)))} · ${esc(meta.label)} ${esc(meta.time)}</span></h1>
    </header>
    <main>
      <div class="steps">${steps}</div>
      <div class="chips">${chips}</div>
      <div class="current">${selMeal ? `Seçili: <b>${esc(selMeal.id)} ${esc(selMeal.title)}</b> <button class="rm" id="rm">Kaldır</button>` : 'Bir öğün seç, sonraki adıma otomatik geçer'}</div>
      <div class="meals">${cards || '<p class="empty-list">Bu kategoride öğün yok</p>'}</div>
    </main>
    <div class="bar">
      <button class="btn" id="prev" ${slot === 'kahvalti' ? 'disabled' : ''}>‹ Önceki</button>
      <button class="btn" id="skip">${slot === 'ara2' ? 'Bitir' : 'Atla ›'}</button>
    </div>
  `;

  const go = (s) => { location.hash = `#/day/${dayIdx}/${s}`; };
  const next = () => {
    const i = SLOT_KEYS.indexOf(slot);
    if (i < SLOT_KEYS.length - 1) go(SLOT_KEYS[i + 1]);
    else location.hash = '#/';
  };
  app.querySelector('#back').addEventListener('click', () => { location.hash = '#/'; });
  app.querySelectorAll('.step').forEach((b) => b.addEventListener('click', () => go(b.dataset.slot)));
  app.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { chip[slot] = b.dataset.cat; render(); }));
  app.querySelector('#rm')?.addEventListener('click', () => { setPlan(setMeal(plan, dayIdx, slot, null)); render(); });
  app.querySelector('#prev').addEventListener('click', () => go(SLOT_KEYS[SLOT_KEYS.indexOf(slot) - 1]));
  app.querySelector('#skip').addEventListener('click', next);
  app.querySelectorAll('.meal').forEach((b) => b.addEventListener('click', (e) => {
    const t = e.target.closest('[data-recipe],[data-more]');
    if (t?.dataset.recipe) { e.stopPropagation(); location.hash = `#/recipe/${t.dataset.recipe}`; return; }
    if (t?.dataset.more) { e.stopPropagation(); openMeal = t.dataset.more; render(); return; }
    setPlan(setMeal(plan, dayIdx, slot, b.dataset.id));
    openMeal = null;
    next();
  }));
}

function renderRecipe(id) {
  const m = byId.get(id);
  if (!m || !m.recipe) { location.hash = '#/'; return; }
  app.innerHTML = `
    <div class="recipe">
      <header class="top">
        <button class="back" id="back" aria-label="Geri">‹</button>
        <h1>${esc(m.id)} ${esc(m.title)}<span class="sub">Tarif</span></h1>
      </header>
      <div class="img"><img src="${esc(m.recipe)}" alt="${esc(m.title)} tarifi"></div>
    </div>`;
  app.querySelector('#back').addEventListener('click', () => history.back());
}

// ---------- actions ----------

async function onPdf() {
  const btn = app.querySelector('#pdf');
  btn.disabled = true; btn.textContent = 'Hazırlanıyor…';
  try {
    const { generatePdf } = await import('./pdf.js');
    await generatePdf(plan, data, rules);
  } catch (e) {
    console.error(e);
    alert('PDF oluşturulamadı: ' + e.message);
  } finally {
    render();
  }
}

async function onShare() {
  const url = `${location.origin}${location.pathname}#p=${encodePlan(plan)}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Haftalık menü', url }); return; } catch { /* cancelled */ return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Bağlantı kopyalandı'); }
  catch { prompt('Bağlantıyı kopyala:', url); }
}

function importFromHash() {
  const m = location.hash.match(/^#p=([A-Za-z0-9_-]+)$/);
  if (!m) return false;
  const p = decodePlan(m[1]);
  if (p && confirm(`Paylaşılan planı yüklemek ister misin? (${weekLabel(p.weekStart)})\nMevcut plan üzerine yazılır.`)) {
    setPlan(p);
    toast('Plan yüklendi');
  }
  history.replaceState(null, '', location.pathname + '#/');
  return true;
}

// ---------- boot ----------

async function boot() {
  const [d, r] = await Promise.all([
    fetch(`data/meals.json?v=${VERSION}`).then((x) => x.json()),
    fetch(`data/rules.json?v=${VERSION}`).then((x) => x.json()),
  ]);
  data = d; rules = r;
  byId = new Map(data.meals.map((m) => [m.id, m]));

  const stored = load(LS_PLAN);
  plan = isValidPlan(stored) ? stored : newPlan(toISODate(new Date()));
  // drop ids that no longer exist in the library
  plan.days.forEach((day) => SLOT_KEYS.forEach((s) => { if (day[s] && !byId.has(day[s])) day[s] = null; }));

  importFromHash();
  window.addEventListener('hashchange', () => { menuOpen = false; render(); });
  render();
}

boot().catch((e) => {
  app.innerHTML = `<main><p class="empty-list">Yüklenemedi: ${esc(e.message)}</p></main>`;
});
