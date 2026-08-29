import {
  SLOT_KEYS, DAY_NAMES, DAY_SHORT, toISODate, mondayOf, addDays, shortDate, weekLabel,
  newPlan, setMeal, clearPlan, withWeekStart, usageCount, filledCount, isValidPlan,
  hints, eggDayCount, encodePlan, decodePlan,
} from './planner.js';

const VERSION = '1'; // bump when data/*.json changes, busts the fetch cache
const LS_PLAN = 'mealplanner.plan';
const LS_LAST = 'mealplanner.lastWeek';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

let data, rules, byId;
let plan;
let chip = {}; // slot -> category key or 'all'
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
  return { view: 'home' };
}

// ---------- views ----------

function render() {
  const r = route();
  if (r.view === 'day') renderDay(r.dayIdx, r.slot);
  else if (r.view === 'recipe') renderRecipe(r.id);
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
      <div><div class="dn">${esc(DAY_SHORT[i])}</div><div class="dd">${esc(shortDate(date))}</div></div>
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
      <button class="btn primary" id="pdf" ${filled === 0 ? 'disabled' : ''}>⬇︎ PDF indir</button>
      <button class="btn" id="share" ${filled === 0 ? 'disabled' : ''}>Paylaş</button>
      <button class="btn icon" id="more" aria-label="Menü">⋯</button>
    </div>
    ${menuOpen ? `<div class="scrim" id="scrim"></div><div class="menu">
      <button id="copyLast" ${load(LS_LAST) ? '' : 'disabled'}>Geçen haftayı kopyala</button>
      <button id="nextWeek">Yeni hafta başlat (bu haftayı sakla)</button>
      <button id="clear" class="danger">Bu haftayı temizle</button>
    </div>` : ''}
  `;

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
  app.querySelector('#copyLast')?.addEventListener('click', () => {
    const last = load(LS_LAST);
    if (isValidPlan(last)) {
      setPlan({ ...plan, days: last.days.map((d) => ({ ...d })) });
      toast('Geçen hafta kopyalandı');
    }
    menuOpen = false; render();
  });
  app.querySelector('#nextWeek')?.addEventListener('click', () => {
    save(LS_LAST, plan);
    setPlan(newPlan(addDays(plan.weekStart, 7)));
    menuOpen = false; render();
    toast('Yeni hafta');
  });
  app.querySelector('#clear')?.addEventListener('click', () => {
    if (confirm('Bu haftanın tüm öğünleri silinsin mi?')) setPlan(clearPlan(plan));
    menuOpen = false; render();
  });
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
    const isOpen = openMeal === m.id;
    const lines = m.lines.map((l, i) => `<li class="${i >= 2 && !isOpen ? 'hidden' : ''}">${esc(l)}</li>`).join('');
    const more = m.lines.length > 2 && !isOpen ? `<li class="more" data-more="${m.id}">+${m.lines.length - 2} satır daha</li>` : '';
    const hint = hs.find((h) => h.mealId === m.id && (h.dayIdx === undefined || h.dayIdx === dayIdx));
    return `<button class="meal ${selected === m.id ? 'sel' : ''} ${isOpen ? 'open' : ''}" data-id="${m.id}">
      <div class="head"><span class="id">${esc(m.id)}</span><span class="title">${esc(m.title)}</span>${use}</div>
      ${m.recipe ? `<span class="tarif" data-recipe="${m.id}">Tarif</span>` : '<span></span>'}
      <ul class="desc">${lines}${more}</ul>
      ${hint ? `<div class="desc" style="color:var(--amber)">⚠ ${esc(hint.text)}</div>` : ''}
    </button>`;
  }).join('');

  app.innerHTML = `
    <header class="top">
      <button class="back" id="back" aria-label="Geri">‹</button>
      <h1>${esc(DAY_NAMES[dayIdx])} <span class="sub">${esc(shortDate(addDays(plan.weekStart, dayIdx)))} · ${esc(meta.label)} ${esc(meta.time)}</span></h1>
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
