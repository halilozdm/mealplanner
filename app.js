import {
  SLOT_KEYS, dayName, dayShort, toISODate, addDays, shortDate, weekLabel,
  newPlan, setMeal, clearPlan, withWeekStart, usageCount, filledCount, isValidPlan,
  hints, eggDayCount, encodePlan, decodePlan, randomizePlan,
} from './planner.js';

const VERSION = '5'; // bump when data/*.json changes, busts the fetch cache
const LS_PLAN = 'mealplanner.plan';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

let data, rules, byId;
let plan;
let chip = {}; // slot -> category key or 'all'
let browseSlot = 'kahvalti'; // recipes view: active slot tab
let openMeal = null; // expanded meal card id
let menuOpen = false;
let shuffleFx = false; // animate day rows once after randomize
let pdfBusy = false;

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

// Inline SVG icons (24x24 stroke set), no external icon font.
const ICONS = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  cutlery: '<path d="M7 3v8M4 3v4a3 3 0 0 0 6 0V3M7 11v10M17 3c-2 0-3 3-3 6v3h3v9M17 3v9"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14l3 3 3-3"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13M8 7h7"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  egg: '<path d="M12 3c-4 0-7 6-7 11a7 7 0 0 0 14 0c0-5-3-11-7-11z"/>',
  logo: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4M8 10v11M13 10v4"/><path d="M20 13c-.3 5-3 8-8 8 0-5 3-8 8-8z" fill="currentColor" stroke="none"/>',
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

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

let lastView = null;
function render() {
  const r = route();
  if (r.view === 'day') renderDay(r.dayIdx, r.slot);
  else if (r.view === 'recipe') renderRecipe(r.id);
  else if (r.view === 'recipes') renderRecipes();
  else renderHome();
  // animate the view only when navigating between screens, not on in-place re-renders
  const mainEl = app.querySelector('main');
  if (mainEl && r.view !== lastView) { mainEl.classList.add('view'); window.scrollTo(0, 0); }
  lastView = r.view;
}

function header(inner) {
  return `<header class="top"><div class="top-in">${inner}</div></header>`;
}

function renderHome() {
  const hs = hints(plan, byId);
  const eggs = eggDayCount(plan, byId);
  const filled = filledCount(plan);
  const warns = hs.filter((h) => h.level === 'warn');
  const overIds = new Set(warns.map((h) => h.mealId));

  const days = plan.days.map((d, i) => {
    const date = addDays(plan.weekStart, i);
    const n = SLOT_KEYS.filter((s) => d[s]).length;
    const dots = SLOT_KEYS.map((s) => `<i class="${d[s] ? 'on' : ''}"></i>`).join('');
    let body;
    if (n === 0) {
      body = `<div class="cta">${icon('plus')} Öğün planla</div>`;
    } else {
      body = `<div class="rows">${SLOT_KEYS.map((s, j) => {
        const m = d[s] ? byId.get(d[s]) : null;
        const bad = m && (overIds.has(m.id) || hs.some((h) => h.dayIdx === i && h.slot === s));
        const pic = m?.image ? `<img class="pic" src="${esc(m.image)}" alt="" loading="lazy" width="36" height="36">` : '';
        return `<div class="row ${m ? 'on' : ''} ${bad ? 'bad' : ''}" style="--i:${j}"><b>${esc(slotMeta(s).short)}</b>${m ? `<span>${esc(m.title)}</span>` : '<span class="empty">—</span>'}${pic}</div>`;
      }).join('')}</div>`;
    }
    return `<button class="day rise ${n === 4 ? 'done' : ''} ${n === 0 ? 'blank' : ''}" data-day="${i}" style="--i:${i}">
      <div class="head"><div class="dn">${esc(dayShort(plan.weekStart, i))}<span>${esc(shortDate(date))}</span></div><div class="dots">${dots}</div></div>
      ${body}
    </button>`;
  }).join('');

  const banners = hs.map((h) => `<div class="banner ${h.level}">${icon(h.level === 'warn' ? 'warn' : 'info')}<div>${esc(h.text)}</div></div>`).join('');

  app.innerHTML = `
    ${header(`
      <div class="logo">${icon('logo')}</div>
      <h1>Haftalık Menü${rules.subtitle ? `<span class="sub">${esc(rules.subtitle)}</span>` : ''}</h1>
      <label class="datebtn">${icon('calendar')}${esc(weekLabel(plan.weekStart))}<input type="date" id="week" value="${plan.weekStart}" aria-label="Hafta başlangıcı"></label>
    `)}
    <main class="${shuffleFx ? 'shuffle' : ''}">
      <div class="stats">
        <span class="stat ${filled === 28 ? 'ok' : ''}">${icon('cutlery')}${filled}/28 öğün</span>
        <span class="stat ${eggs >= 4 ? 'terra' : ''}">${icon('egg')}${eggs}/4 gün</span>
        ${warns.length ? `<span class="stat warn">${icon('warn')}${warns.length} uyarı</span>` : ''}
      </div>
      ${banners ? `<div class="banners">${banners}</div>` : ''}
      <div class="days">${days}</div>
    </main>
    ${nav('plan', filled)}
    ${menuOpen ? `<div class="scrim" id="scrim"></div><div class="sheet" role="menu">
      <div class="grab"></div>
      <button class="item" id="random"><span class="ic">${icon('dice')}</span><span>Rastgele doldur<small>28 öğünü kurallara uygun rastgele seç</small></span></button>
      <button class="item danger" id="clear"><span class="ic">${icon('trash')}</span><span>Haftayı temizle<small>Tüm öğünleri sil</small></span></button>
      <button class="cancel" id="cancel">Vazgeç</button>
    </div>` : ''}
  `;
  shuffleFx = false;
  bindNav();

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
  app.querySelector('#scrim')?.addEventListener('click', () => { menuOpen = false; render(); });
  app.querySelector('#cancel')?.addEventListener('click', () => { menuOpen = false; render(); });
  app.querySelector('#random')?.addEventListener('click', () => {
    if (filledCount(plan) === 0 || confirm('Mevcut öğünler rastgele yenileriyle değiştirilsin mi?')) {
      setPlan(randomizePlan(plan, data.meals));
      shuffleFx = true;
      toast('Hafta rastgele dolduruldu');
    }
    menuOpen = false; render();
  });
  app.querySelector('#clear')?.addEventListener('click', () => {
    if (confirm('Bu haftanın tüm öğünleri silinsin mi?')) setPlan(clearPlan(plan));
    menuOpen = false; render();
  });
}

// ---------- shared: bottom nav + meal card ----------

function nav(active, filled = filledCount(plan)) {
  const dis = filled === 0 ? 'disabled' : '';
  return `<nav class="nav">
    <button class="ni ${active === 'plan' ? 'on' : ''}" data-go="#/">${icon('calendar')}<span>Plan</span></button>
    <button class="ni ${active === 'recipes' ? 'on' : ''}" data-go="#/recipes">${icon('cutlery')}<span>Tarifler</span></button>
    <div class="fab-wrap"><button class="fab" id="pdf" ${dis || pdfBusy ? 'disabled' : ''} aria-label="PDF indir">${pdfBusy ? '<span class="spin"></span>' : icon('pdf')}</button><span class="lbl">PDF</span></div>
    <button class="ni" id="share" ${dis}>${icon('share')}<span>Paylaş</span></button>
    <button class="ni" id="more" aria-label="Menü">${icon('more')}<span>Diğer</span></button>
  </nav>`;
}
function bindNav() {
  app.querySelectorAll('.ni[data-go]').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.go; }));
  app.querySelector('#pdf')?.addEventListener('click', onPdf);
  app.querySelector('#share')?.addEventListener('click', onShare);
  app.querySelector('#more')?.addEventListener('click', () => {
    if (route().view !== 'home') { location.hash = '#/'; menuOpen = true; return; }
    menuOpen = !menuOpen; render();
  });
}

/** Meal card markup shared by the day wizard and the recipe browser. */
function mealCard(m, i, { selected = false, use = '', hint = null } = {}) {
  const isOpen = openMeal === m.id;
  const lines = m.lines.map((l, k) => `<li class="${k >= 2 && !isOpen ? 'hidden' : ''}">${esc(l)}</li>`).join('');
  const more = m.lines.length > 2 ? `<span class="more" data-more="${m.id}">${isOpen ? 'Daha az' : `+${m.lines.length - 2} satır`} ${icon('down')}</span>` : '<span></span>';
  const visual = m.image ? `<img class="thumb" src="${esc(m.image)}" alt="" loading="lazy" width="84" height="84">` : `<div class="tile">${esc(m.id)}</div>`;
  return `<button class="meal rise ${selected ? 'sel' : ''} ${isOpen ? 'open' : ''}" data-id="${m.id}" style="--i:${Math.min(i, 8)}">
    ${visual}
    <div class="body">
      <div class="head"><span class="title">${esc(m.title)}</span>${use}</div>
      <ul class="desc">${lines}</ul>
    </div>
    ${selected ? `<span class="check">${icon('check')}</span>` : ''}
    <div class="foot">${more}${m.recipe ? `<span class="tarif" data-recipe="${m.id}">${icon('book')} Tarif</span>` : ''}</div>
    ${hint ? `<div class="warnline">${icon('warn')}<span>${esc(hint.text)}</span></div>` : ''}
  </button>`;
}

function chipsHtml(cats, cur) {
  return [`<button class="chip ${cur === 'all' ? 'on' : ''}" data-cat="all">Hepsi</button>`]
    .concat(cats.map((c) => `<button class="chip ${cur === c.key ? 'on' : ''}" data-cat="${c.key}">${esc(c.label)}</button>`)).join('');
}

function renderRecipes() {
  const cats = data.categories[browseSlot];
  const cur = chip['browse:' + browseSlot] || 'all';
  const list = data.meals.filter((m) => m.slot === browseSlot && (cur === 'all' || m.category === cur));
  const sm = slotMeta(browseSlot);

  const slotTabs = SLOT_KEYS.map((s) => {
    const n = data.meals.filter((m) => m.slot === s).length;
    return `<button class="tab ${s === browseSlot ? 'on' : ''}" data-slot="${s}">${esc(slotMeta(s).short)}<small>(${n})</small></button>`;
  }).join('');

  app.innerHTML = `
    ${header(`<div class="logo">${icon('logo')}</div><h1>Haftalık Menü</h1>`)}
    <main>
      <h2 class="page-title">Tarifler</h2>
      <p class="page-sub">${data.meals.length} öğün · ${esc(sm.label)} ${esc(sm.time)}</p>
      <div class="tabs">${slotTabs}</div>
      <div class="chips">${chipsHtml(cats, cur)}</div>
      <div class="meals">${list.map((m, i) => mealCard(m, i)).join('') || '<p class="empty-list">Bu kategoride öğün yok</p>'}</div>
    </main>
    ${nav('recipes')}
  `;
  bindNav();
  app.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { browseSlot = b.dataset.slot; openMeal = null; render(); window.scrollTo(0, 0); }));
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
  const setCount = SLOT_KEYS.filter((s) => d[s]).length;

  const steps = SLOT_KEYS.map((s, i) => {
    const sm = slotMeta(s);
    return `<button class="step ${s === slot ? 'cur' : ''} ${d[s] ? 'set' : ''}" data-slot="${s}">
      <span class="c">${d[s] ? icon('check') : i + 1}</span><span class="l">${esc(sm.short)}</span><span class="t">${esc(sm.time.split(' ')[0])}</span>
    </button>`;
  }).join('');

  const cards = list.map((m, i) => {
    const n = usageCount(plan, m.id);
    let use = '';
    if (m.maxPerWeek) use = `<span class="use ${n > m.maxPerWeek ? 'over' : ''}">${n}/${m.maxPerWeek}</span>`;
    else if (n > 0) use = `<span class="use">${n}×</span>`;
    const hint = hs.find((h) => h.mealId === m.id && (h.dayIdx === undefined || h.dayIdx === dayIdx));
    return mealCard(m, i, { selected: selected === m.id, use, hint });
  }).join('');

  const last = slot === 'ara2';
  app.innerHTML = `
    ${header(`
      <button class="back" id="back" aria-label="Geri">${icon('back')}</button>
      <h1>${esc(dayName(plan.weekStart, dayIdx))}<span class="sub">${esc(shortDate(addDays(plan.weekStart, dayIdx)))} · ${esc(meta.label)} ${esc(meta.time)}</span></h1>
    `)}
    <main>
      <div class="progress"><i style="width:${(setCount / 4) * 100}%"></i></div>
      <div class="steps">${steps}</div>
      <div class="chips">${chipsHtml(cats, cur)}</div>
      ${selMeal
        ? `<div class="current">${icon('check')}<span class="txt">Seçili: <b>${esc(selMeal.id)} ${esc(selMeal.title)}</b></span><button class="rm" id="rm">Kaldır</button></div>`
        : `<div class="current hint">${icon('info')}<span class="txt">Bir öğün seç, sonraki adıma otomatik geçer</span></div>`}
      <div class="meals">${cards || '<p class="empty-list">Bu kategoride öğün yok</p>'}</div>
    </main>
    <div class="bar">
      <button class="btn" id="prev" ${slot === 'kahvalti' ? 'disabled' : ''}>${icon('back')} Önceki</button>
      <button class="btn ${last ? 'primary' : ''}" id="skip">${last ? `Bitir ${icon('check')}` : `İleri ${icon('next')}`}</button>
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
    if (t?.dataset.more) {
      e.stopPropagation();
      const y = window.scrollY;
      openMeal = openMeal === t.dataset.more ? null : t.dataset.more;
      render(); window.scrollTo(0, y);
      return;
    }
    setPlan(setMeal(plan, dayIdx, slot, b.dataset.id));
    openMeal = null;
    next();
  }));
}

function renderRecipe(id) {
  const m = byId.get(id);
  if (!m || !m.recipe) { location.hash = '#/'; return; }
  app.innerHTML = `
    ${header(`
      <button class="back" id="back" aria-label="Geri">${icon('back')}</button>
      <h1>Tarif</h1>
    `)}
    <main>
      ${m.image ? `<img class="hero rise" src="${esc(m.image)}" alt="${esc(m.title)}">` : ''}
      <div class="recipe-card rise" style="--i:1">
        <div class="eyebrow">${esc(m.id)} · ${esc(slotMeta(m.slot).label)}</div>
        <h2>${esc(m.title)}</h2>
        <ul>${m.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      </div>
      <div class="eyebrow-sec rise" style="--i:2">Diyetisyenin tarif kartı</div>
      <img class="recipe-img rise" style="--i:3" src="${esc(m.recipe)}" alt="${esc(m.title)} tarifi" loading="lazy">
    </main>`;
  app.querySelector('#back').addEventListener('click', () => history.back());
}

// ---------- actions ----------

async function onPdf() {
  if (pdfBusy) return;
  pdfBusy = true; render();
  try {
    const { generatePdf } = await import('./pdf.js');
    await generatePdf(plan, data, rules);
    toast('PDF hazır');
  } catch (e) {
    console.error(e);
    alert('PDF oluşturulamadı: ' + e.message);
  } finally {
    pdfBusy = false;
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
  window.addEventListener('hashchange', () => { if (route().view !== 'home') menuOpen = false; render(); });
  render();
}

boot().catch((e) => {
  app.innerHTML = `<main><p class="empty-list">Yüklenemedi: ${esc(e.message)}</p></main>`;
});
