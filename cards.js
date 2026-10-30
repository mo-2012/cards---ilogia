/* ============================================================
   iLogia Cards — منطق التطبيق (Frontend فقط، تخزين محلي localStorage)
   جزء من منظومة iLogia — الهوية البصرية من ilogia-ds.css
   ============================================================ */
'use strict';

/* ---------- أدوات عامة ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
const DAY = 864e5;

const fmtDate = ts => new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(new Date(ts));
const fmtTime = ts => new Intl.DateTimeFormat('ar-EG', { timeStyle: 'short' }).format(new Date(ts));
const fmtNum  = n  => new Intl.NumberFormat('ar-EG').format(n);

function startOfDay(ts = Date.now()) { const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }
function daysFromNow(n) { return startOfDay() + n * DAY; }
function relDue(ts) {
  const diff = Math.round((startOfDay(ts) - startOfDay()) / DAY);
  if (diff <= 0) return 'اليوم';
  if (diff === 1) return 'غدًا';
  return `بعد ${fmtNum(diff)} يوم`;
}

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600);
}

/* حوار عام */
function openDlg(html) { $('#dlgBody').innerHTML = html; const d = $('#dlg'); if (!d.open) d.showModal(); }
function closeDlg() { $('#dlg').close(); }
$('#dlgX').addEventListener('click', closeDlg);
$('#dlg').addEventListener('click', e => { if (e.target === e.currentTarget) closeDlg(); });

function confirmDlg(title, body, okLabel, onOk, danger = true) {
  openDlg(`
    <h2 id="dlgTitle">${esc(title)}</h2>
    <p style="color:var(--mut)">${esc(body)}</p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-block-start:16px">
      <button class="btn g" id="cfNo">إلغاء</button>
      <button class="btn ${danger ? 'd' : ''}" id="cfOk">${esc(okLabel)}</button>
    </div>`);
  $('#cfNo').onclick = closeDlg;
  $('#cfOk').onclick = () => { closeDlg(); onOk(); };
}

/* ============================================================
   طبقة البيانات — LocalStorage
   ملاحظة: بنية الحقول مطابقة لجداول Supabase المقترحة
   (انظر supabase-schema.sql) لتسهيل الترحيل لاحقًا.
   ============================================================ */
const LS_KEY = 'ilogia_cards_v1';

const Store = {
  data: null,

  load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) { this.data = JSON.parse(raw); return; }
    } catch (e) { console.error('تعذر قراءة التخزين المحلي', e); }
    this.data = { decks: [], cards: [], reviews: [], sessions: [], settings: {
      dailyNew: 20, dailyReview: 100, theme: 'auto', notifEnabled: false, notifTime: '18:00'
    }};
    this.save();
  },

  save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.data)); }
    catch (e) { toast('تعذر الحفظ محليًا — تحقق من مساحة التخزين'); console.error(e); }
  },

  /* --- decks --- */
  decks() { return this.data.decks.slice().sort((a, b) => b.updatedAt - a.updatedAt); },
  deck(id) { return this.data.decks.find(d => d.id === id); },
  addDeck(d) {
    const deck = { id: uid(), name: d.name, subject: d.subject || '', grade: d.grade || '',
      description: d.description || '', color: d.color || '#136F58',
      createdAt: Date.now(), updatedAt: Date.now() };
    this.data.decks.push(deck); this.save(); return deck;
  },
  updateDeck(id, patch) {
    const d = this.deck(id); if (!d) return;
    Object.assign(d, patch, { updatedAt: Date.now() }); this.save();
  },
  deleteDeck(id) {
    this.data.decks = this.data.decks.filter(d => d.id !== id);
    const cardIds = new Set(this.data.cards.filter(c => c.deckId === id).map(c => c.id));
    this.data.cards = this.data.cards.filter(c => c.deckId !== id);
    this.data.reviews = this.data.reviews.filter(r => !cardIds.has(r.cardId));
    this.save();
  },
  duplicateDeck(id) {
    const src = this.deck(id); if (!src) return null;
    const copy = this.addDeck({ name: src.name + ' (نسخة)', subject: src.subject, grade: src.grade, description: src.description, color: src.color });
    this.deckCards(id).forEach(c => this.addCard(copy.id, { front: c.front, back: c.back, favorite: c.favorite }));
    return copy;
  },

  /* --- cards --- */
  deckCards(deckId) { return this.data.cards.filter(c => c.deckId === deckId).sort((a, b) => a.createdAt - b.createdAt); },
  card(id) { return this.data.cards.find(c => c.id === id); },
  addCard(deckId, c) {
    const card = { id: uid(), deckId, front: c.front, back: c.back, favorite: !!c.favorite,
      createdAt: Date.now(), updatedAt: Date.now(),
      /* حقول التكرار المتباعد — انظر SRS */
      difficulty: 0, nextReview: Date.now(), ease: 2.5, interval: 0, reps: 0, lapses: 0, state: 'new' };
    this.data.cards.push(card);
    const d = this.deck(deckId); if (d) d.updatedAt = Date.now();
    this.save(); return card;
  },
  updateCard(id, patch) {
    const c = this.card(id); if (!c) return;
    Object.assign(c, patch, { updatedAt: Date.now() }); this.save();
  },
  deleteCard(id) {
    this.data.cards = this.data.cards.filter(c => c.id !== id);
    this.data.reviews = this.data.reviews.filter(r => r.cardId !== id);
    this.save();
  },

  /* --- reviews / sessions --- */
  addReview(r) { this.data.reviews.push({ id: uid(), ...r, reviewedAt: Date.now() }); this.save(); },
  addSession(s) { const sess = { id: uid(), startedAt: Date.now(), ...s }; this.data.sessions.push(sess); this.save(); return sess; },
  updateSession(id, patch) { const s = this.data.sessions.find(x => x.id === id); if (s) Object.assign(s, patch); this.save(); },

  settings() { return this.data.settings; },
  saveSettings(p) { Object.assign(this.data.settings, p); this.save(); },
};

/* ============================================================
   محرك التكرار المتباعد — خوارزمية SM-2 (SuperMemo 2)
   ------------------------------------------------------------
   - لكل كارت: ease (معامل السهولة، يبدأ 2.5، حده الأدنى 1.3)،
     interval (الفترة بالأيام)، reps (تكرارات متتالية ناجحة)،
     lapses (عدد مرات النسيان)، state (new | learning | review | relearning).
   - التقييمات: again=1, hard=3, good=4, easy=5 (مقياس SM-2 من 0-5).
   - إذا كانت الجودة < 3 (again): يعود الكارت لمرحلة التعلم،
     الفترة تُصفّر، وتزداد lapses، ويُعاد عرضه في نفس الجلسة.
   - وإلا: الفترة = 1 يوم لأول نجاح، 6 أيام للثاني،
     ثم الفترة السابقة × ease.
   - يُحدَّث ease بالمعادلة القياسية:
     ease' = ease + (0.1 - (5-q) * (0.08 + (5-q) * 0.02))
   - hard يعامل بمعامل 1.2 بدل ease حتى لا يتضخم تباعده.
   الموعد القادم = بداية يوم (اليوم الحالي + الفترة).
   ============================================================ */
const RATING = { again: 1, hard: 3, good: 4, easy: 5 };

const SRS = {
  review(card, ratingKey) {
    const q = RATING[ratingKey];
    let { ease, interval, reps, lapses, state } = card;

    if (q < 3) {
      reps = 0; lapses += 1; interval = 0;
      state = (state === 'new' || state === 'learning') ? 'learning' : 'relearning';
    } else {
      reps += 1;
      if (reps === 1) interval = 1;
      else if (reps === 2) interval = 6;
      else interval = Math.round(interval * (ratingKey === 'hard' ? 1.2 : ease));
      ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
      state = 'review';
    }
    if (ratingKey === 'easy' && reps <= 2) interval = Math.max(interval, 4);

    const nextReview = interval === 0 ? Date.now() + 10 * 60 * 1000 /* بعد 10 دقائق داخل الجلسة */
                                      : daysFromNow(interval);
    const patch = { ease, interval, reps, lapses, state, nextReview, difficulty: Math.round((2.5 - ease) * 10) / 10 };
    Store.updateCard(card.id, patch);
    Store.addReview({ cardId: card.id, deckId: card.deckId, rating: ratingKey, nextDue: nextReview });
    return patch;
  },

  dueCards(deckId = null, manual = false) {
    const now = Date.now();
    let pool = Store.data.cards.filter(c => (!deckId || c.deckId === deckId));
    if (!manual) pool = pool.filter(c => c.nextReview <= now);
    const { dailyNew, dailyReview } = Store.settings();
    const fresh = pool.filter(c => c.state === 'new');
    const rest  = pool.filter(c => c.state !== 'new').slice(0, manual ? pool.length : dailyReview);
    return [...rest, ...(manual ? fresh : fresh.slice(0, dailyNew))].sort((a, b) => a.nextReview - b.nextReview);
  },

  dueCount(deckId = null) {
    const now = Date.now();
    return Store.data.cards.filter(c => (!deckId || c.deckId === deckId) && c.nextReview <= now).length;
  },

  dueByDay(offset) {
    const d0 = daysFromNow(offset), d1 = d0 + DAY;
    return Store.data.cards.filter(c => c.nextReview >= d0 && c.nextReview < d1).length;
  },

  reviewedOn(dayStart) {
    const d1 = dayStart + DAY;
    return Store.data.reviews.filter(r => r.reviewedAt >= dayStart && r.reviewedAt < d1);
  },

  mastery(deckId = null) {
    const cards = Store.data.cards.filter(c => !deckId || c.deckId === deckId);
    if (!cards.length) return 0;
    const learned = cards.filter(c => c.state === 'review' && c.interval >= 21).length;
    const learning = cards.filter(c => c.state === 'review' && c.interval < 21).length;
    return Math.round(((learned + learning * 0.5) / cards.length) * 100);
  },
};

/* حفظ تلقائي عند الإغلاق/انقطاع مفاجئ (البيانات كلها محلية أصلًا) */
window.addEventListener('beforeunload', () => Store.save());

/* ============================================================
   الموجّه (Hash Router) + الهيكل العام
   ============================================================ */
const ROUTES = {
  dashboard: { title: 'لوحة التحكم',   render: renderDashboard },
  decks:     { title: 'مجموعاتي',      render: renderDecks },
  deck:      { title: 'تفاصيل المجموعة', render: renderDeckDetails },
  editor:    { title: 'محرر الكروت',   render: renderEditor },
  study:     { title: 'جلسة مراجعة',   render: renderStudy },
  calendar:  { title: 'تقويم المراجعات', render: renderCalendar },
  stats:     { title: 'الإحصائيات',    render: renderStats },
  settings:  { title: 'الإعدادات',     render: renderSettings },
};

let calOffset = 0; // إزاحة شهر التقويم

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [pathPart, queryPart] = h.split('?');
  const seg = pathPart.split('/').filter(Boolean);
  return { route: seg[0] || 'dashboard', param: seg[1] || null, param2: seg[2] || null, query: new URLSearchParams(queryPart || '') };
}

function router() {
  const { route, param, param2, query } = parseHash();
  const r = ROUTES[route] || ROUTES.dashboard;
  document.title = `iLogia Cards — ${r.title}`;
  $('#pageTitle').textContent = r.title;
  $$('#sideNav a').forEach(a => {
    if (a.dataset.route === (ROUTES[route] ? route : 'dashboard')) a.setAttribute('aria-current', '');
    else a.removeAttribute('aria-current');
  });
  const main = $('#main');
  main.className = 'main up';
  Study.teardown();
  r.render(main, param, param2, query);
  refreshSideDue();
  closeSide();
  main.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', router);

function refreshSideDue() {
  const n = SRS.dueCount();
  $('#sideDue').hidden = n === 0;
  $('#sideDueN').textContent = fmtNum(n);
}

/* ===== sidebar (موبايل) ===== */
function closeSide() { $('#side').classList.remove('open'); $('#sideScrim').hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); }
$('#menuBtn').addEventListener('click', () => {
  const open = $('#side').classList.toggle('open');
  $('#sideScrim').hidden = !open;
  $('#menuBtn').setAttribute('aria-expanded', String(open));
});
$('#sideScrim').addEventListener('click', closeSide);

/* ===== المظهر ===== */
function applyTheme() {
  const t = Store.settings().theme;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
}
$('#themeBtn').addEventListener('click', () => {
  const cur = Store.settings().theme;
  const next = cur === 'light' ? 'dark' : cur === 'dark' ? 'auto' : 'light';
  Store.saveSettings({ theme: next });
  applyTheme();
  toast(next === 'dark' ? 'المظهر الداكن' : next === 'light' ? 'المظهر الفاتح' : 'المظهر التلقائي');
});

/* ===== شرح الخوارزمية ===== */
$('#algoInfo').addEventListener('click', () => {
  openDlg(`
    <h2 id="dlgTitle">خوارزمية SM-2 للتكرار المتباعد</h2>
    <div style="display:grid;gap:10px;font-size:var(--fs-14);color:var(--mut)">
      <p>يقيّم الطالب تذكّره لكل كارت بأحد أربعة مستويات: <b>Again / Hard / Good / Easy</b>.</p>
      <p>• <b>Again:</b> يعود الكارت فورًا لمرحلة التعلم ويظهر مجددًا خلال الجلسة وبوتيرة أعلى لاحقًا.</p>
      <p>• أول نجاح يؤجل الكارت يومًا واحدًا، والثاني 6 أيام، ثم تُضرب الفترة في «معامل السهولة» الخاص بالكارت.</p>
      <p>• كل إجابة ناجحة ترفع معامل السهولة قليلًا، وكل «Hard» يخفضه، فتتباعد الكروت السهلة وتتقارب الصعبة تلقائيًا.</p>
      <p>• لا تظهر الكروت غير المستحقة في المراجعة اليومية إلا إذا اخترت «مراجعة يدوية».</p>
      <p style="margin:0">هذه الخوارزمية مطبقة فعليًا في <code>cards.js</code> ضمن الكائن <code>SRS</code>، وقابلة للاستبدال بخوارزميات أحدث (FSRS مثلًا) دون تغيير بقية التطبيق.</p>
    </div>`);
});

/* ===== مكونات مشتركة ===== */
function statTile(icon, label, value, cls = '') {
  return `<div class="stat-ic"><span class="ms ${cls}" aria-hidden="true">${icon}</span><span>${label}<b>${value}</b></span></div>`;
}
function emptyState(icon, title, body, actionHtml = '') {
  return `<div class="empty-state"><span class="ms" aria-hidden="true">${icon}</span><h3>${esc(title)}</h3><p>${esc(body)}</p>${actionHtml}</div>`;
}
function bar(pct, color) {
  return `<div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="inline-size:${pct}%${color ? `;background:${color}` : ''}"></i></div>`;
}
function deckBadge(deck) {
  return `<span class="badge" style="background:${deck.color}18;color:${deck.color}">${esc(deck.subject || 'عام')}</span>`;
}
function deckCardHtml(deck) {
  const cards = Store.deckCards(deck.id);
  const due = SRS.dueCount(deck.id);
  const mastery = SRS.mastery(deck.id);
  return `
  <a class="deck-card" href="#/deck/${deck.id}" style="--c:${deck.color}">
    ${due ? `<span class="due-pill">${fmtNum(due)} مستحق</span>` : ''}
    ${deckBadge(deck)}
    <h3>${esc(deck.name)}</h3>
    <div class="meta">${deck.grade ? `<span>${esc(deck.grade)}</span>` : ''}<span>أُنشئت ${fmtDate(deck.createdAt)}</span></div>
    <div class="nums"><span><b>${fmtNum(cards.length)}</b> كارت</span><span>إتقان <b>${fmtNum(mastery)}٪</b></span></div>
    ${bar(mastery)}
  </a>`;
}

/* ============================================================
   1) لوحة التحكم
   ============================================================ */
function renderDashboard(main) {
  const decks = Store.decks();
  const totalCards = Store.data.cards.length;
  const due = SRS.dueCount();
  const todayReviews = SRS.reviewedOn(startOfDay()).length;
  const mastery = SRS.mastery();

  if (!decks.length) {
    main.innerHTML = `
      <section class="dash-hero">
        <span class="ms hero-ic" aria-hidden="true">school</span>
        <div><h2>مرحبًا بك في iLogia Cards</h2><p>أنشئ أول مجموعة كروت وابدأ المراجعة بالتكرار المتباعد.</p></div>
      </section>
      ${emptyState('style', 'لا توجد مجموعات بعد', 'أنشئ مجموعة كروت لمادتك الأولى وابدأ رحلة الحفظ والمراجعة.',
        `<a class="btn" href="#/decks?new=1"><span class="ms" aria-hidden="true">add</span>إنشاء أول مجموعة</a>`)}`;
    return;
  }

  const recent = decks.slice(0, 4);
  main.innerHTML = `
    <section class="dash-hero">
      <span class="ms hero-ic" aria-hidden="true">psychology</span>
      <div><h2>${due ? `لديك ${fmtNum(due)} كارت مستحق اليوم` : 'لا توجد كروت مستحقة الآن'}</h2>
      <p>${due ? 'جلسة قصيرة الآن توفر عليك ساعات لاحقًا.' : 'أحسنت! يمكنك إضافة كروت جديدة أو مراجعة يدوية.'}</p></div>
      <div class="acts">
        ${due ? `<a class="btn gold" href="#/study"><span class="ms" aria-hidden="true">play_arrow</span>ابدأ المراجعة</a>` : ''}
        <a class="btn g" href="#/decks?new=1"><span class="ms" aria-hidden="true">add</span>مجموعة جديدة</a>
      </div>
    </section>

    <div class="stats">
      ${statTile('style', 'إجمالي الكروت', fmtNum(totalCards))}
      ${statTile('dashboard', 'المجموعات', fmtNum(decks.length))}
      ${statTile('bolt', 'مستحق اليوم', fmtNum(due), due ? 'err' : '')}
      ${statTile('check', 'راجعت اليوم', fmtNum(todayReviews))}
      ${statTile('grade', 'معدل الإتقان', fmtNum(mastery) + '٪', 'gold')}
    </div>

    <div class="sec-head"><h2>آخر المجموعات</h2><a class="lnk" href="#/decks">عرض الكل</a></div>
    <div class="decks">${recent.map(deckCardHtml).join('')}</div>

    <div class="sec-head"><h2>تقدمك هذا الأسبوع</h2></div>
    <div class="card" style="margin:0">${weekChartHtml()}</div>`;
}

function weekChartHtml() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = startOfDay() - i * DAY;
    days.push({ label: new Intl.DateTimeFormat('ar-EG', { weekday: 'short' }).format(new Date(d)), n: SRS.reviewedOn(d).length });
  }
  const max = Math.max(1, ...days.map(d => d.n));
  return `<div class="week" role="img" aria-label="المراجعات آخر 7 أيام">` +
    days.map(d => `<div class="${d.n ? 'td' : ''}" title="${fmtNum(d.n)} مراجعة"><i style="block-size:${Math.round(d.n / max * 100)}%"></i>${d.label}</div>`).join('') +
  `</div>`;
}

/* ============================================================
   2) مجموعاتي (My Decks)
   ============================================================ */
const deckFilters = { q: '', subject: '', grade: '' };

function renderDecks(main, _p, _p2, query) {
  const decks = Store.decks();
  const subjects = [...new Set(decks.map(d => d.subject).filter(Boolean))];
  const grades = [...new Set(decks.map(d => d.grade).filter(Boolean))];

  main.innerHTML = `
    <div class="tools-bar">
      <input type="search" id="dq" placeholder="ابحث في المجموعات…" value="${esc(deckFilters.q)}" aria-label="بحث">
      <select id="dsub" aria-label="تصفية بالمادة"><option value="">كل المواد</option>${subjects.map(s => `<option ${deckFilters.subject === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select id="dgrade" aria-label="تصفية بالصف"><option value="">كل الصفوف</option>${grades.map(g => `<option ${deckFilters.grade === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
      <button class="btn" id="addDeck"><span class="ms" aria-hidden="true">add</span>مجموعة جديدة</button>
      <button class="btn g" id="impDeck"><span class="ms" aria-hidden="true">upload</span>استيراد</button>
    </div>
    <div class="decks" id="deckGrid"></div>`;

  function draw() {
    const list = decks.filter(d =>
      (!deckFilters.q || (d.name + ' ' + d.subject + ' ' + d.description).includes(deckFilters.q)) &&
      (!deckFilters.subject || d.subject === deckFilters.subject) &&
      (!deckFilters.grade || d.grade === deckFilters.grade));
    $('#deckGrid').innerHTML = list.length
      ? list.map(deckCardHtml).join('')
      : emptyState('search', 'لا نتائج مطابقة', decks.length ? 'جرّب تعديل البحث أو التصفية.' : 'أنشئ أول مجموعة لتبدأ.');
  }
  draw();

  $('#dq').addEventListener('input', e => { deckFilters.q = e.target.value.trim(); draw(); });
  $('#dsub').addEventListener('change', e => { deckFilters.subject = e.target.value; draw(); });
  $('#dgrade').addEventListener('change', e => { deckFilters.grade = e.target.value; draw(); });
  $('#addDeck').addEventListener('click', () => deckFormDlg(null));
  $('#impDeck').addEventListener('click', () => importDeckDlg());
  if (query?.get('new') === '1') deckFormDlg(null);
}

const DECK_COLORS = ['#136F58', '#0E5040', '#D4AF37', '#82C341', '#2E5E8C', '#8C4A2E', '#6B4A8C', '#B02A2A'];

function deckFormDlg(deck) {
  openDlg(`
    <h2 id="dlgTitle">${deck ? 'تعديل المجموعة' : 'مجموعة جديدة'}</h2>
    <form id="deckForm">
      <label>اسم المجموعة<input name="name" required maxlength="80" value="${esc(deck?.name || '')}" placeholder="مثال: مصطلحات الأحياء — الوحدة الأولى"></label>
      <label>المادة<input name="subject" maxlength="40" value="${esc(deck?.subject || '')}" placeholder="مثال: أحياء"></label>
      <label>الصف الدراسي<input name="grade" maxlength="40" value="${esc(deck?.grade || '')}" placeholder="مثال: الصف الثالث الثانوي"></label>
      <label>وصف مختصر (اختياري)<textarea name="description" maxlength="300" placeholder="عمّ تدور هذه المجموعة؟">${esc(deck?.description || '')}</textarea></label>
      <label>لون المجموعة</label>
      <div class="chips-row" id="colorPick" role="radiogroup" aria-label="لون المجموعة">
        ${DECK_COLORS.map((c, i) => `<button type="button" class="chip" data-c="${c}" aria-pressed="${(deck?.color || DECK_COLORS[0]) === c}" style="background:${c};border-color:${c};inline-size:36px;min-block-size:36px;padding:0" aria-label="لون ${i + 1}"></button>`).join('')}
      </div>
      <div class="fieldmsg" id="deckErr"></div>
      <button class="btn" type="submit">${deck ? 'حفظ التعديلات' : 'إنشاء المجموعة'}</button>
    </form>`);
  let color = deck?.color || DECK_COLORS[0];
  $$('#colorPick .chip').forEach(b => b.addEventListener('click', () => {
    color = b.dataset.c;
    $$('#colorPick .chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  $('#deckForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get('name')).trim();
    if (!name) { $('#deckErr').textContent = 'اسم المجموعة مطلوب.'; return; }
    const payload = { name, subject: String(f.get('subject')).trim(), grade: String(f.get('grade')).trim(), description: String(f.get('description')).trim(), color };
    if (deck) { Store.updateDeck(deck.id, payload); toast('تم حفظ التعديلات'); closeDlg(); router(); }
    else { const d = Store.addDeck(payload); closeDlg(); toast('تم إنشاء المجموعة'); location.hash = `#/deck/${d.id}`; }
  });
}

/* ============================================================
   3) تفاصيل المجموعة + قائمة الكروت
   ============================================================ */
const cardListState = { q: '', favOnly: false };

function renderDeckDetails(main, deckId) {
  const deck = Store.deck(deckId);
  if (!deck) { main.innerHTML = emptyState('warning', 'المجموعة غير موجودة', 'ربما حُذفت.', `<a class="btn" href="#/decks">العودة لمجموعاتي</a>`); return; }
  const cards = Store.deckCards(deckId);
  const due = SRS.dueCount(deckId);
  const mastery = SRS.mastery(deckId);

  main.innerHTML = `
    <a class="lnk" href="#/decks" style="min-block-size:auto">← كل المجموعات</a>
    <section class="dash-hero" style="--c:${deck.color}">
      <span class="ms hero-ic" aria-hidden="true">style</span>
      <div style="min-inline-size:0">
        <h2>${esc(deck.name)}</h2>
        <p>${deckBadge(deck)} ${deck.grade ? `<span style="opacity:.85;font-size:var(--fs-12)">· ${esc(deck.grade)}</span>` : ''}</p>
        ${deck.description ? `<p style="font-size:var(--fs-14)">${esc(deck.description)}</p>` : ''}
      </div>
      <div class="acts">
        ${due ? `<a class="btn gold" href="#/study/${deckId}"><span class="ms" aria-hidden="true">play_arrow</span>مراجعة المستحق (${fmtNum(due)})</a>` : ''}
        ${cards.length ? `<a class="btn g" href="#/study/${deckId}?mode=all"><span class="ms" aria-hidden="true">restart_alt</span>مراجعة يدوية شاملة</a>` : ''}
      </div>
    </section>

    <div class="stats">
      ${statTile('style', 'عدد الكروت', fmtNum(cards.length))}
      ${statTile('bolt', 'مستحق اليوم', fmtNum(due), due ? 'err' : '')}
      ${statTile('grade', 'مستوى الإتقان', fmtNum(mastery) + '٪', 'gold')}
      ${statTile('favorite', 'مفضلة', fmtNum(cards.filter(c => c.favorite).length), 'gold')}
    </div>
    <div class="card" style="margin-block-end:var(--sp-6)">${bar(mastery, deck.color)}</div>

    <div class="sec-head"><h2>الكروت</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn" href="#/editor/${deckId}"><span class="ms" aria-hidden="true">add</span>إضافة كروت</a>
        <button class="btn g" id="editDeck"><span class="ms" aria-hidden="true">edit</span>تعديل</button>
        <button class="btn g" id="dupDeck"><span class="ms" aria-hidden="true">content_copy</span>نسخ</button>
        <button class="btn g" id="expDeck"><span class="ms" aria-hidden="true">download</span>تصدير</button>
        <button class="btn d" id="delDeck"><span class="ms" aria-hidden="true">delete</span>حذف</button>
      </div>
    </div>

    <div class="tools-bar">
      <input type="search" id="cq" placeholder="ابحث داخل كروت المجموعة…" value="${esc(cardListState.q)}" aria-label="بحث في الكروت">
      <button class="chip" id="favOnly" aria-pressed="${cardListState.favOnly}"><span class="ms" style="font-size:16px" aria-hidden="true">favorite</span> المفضلة فقط</button>
    </div>
    <div class="cardlist" id="cardList"></div>`;

  function drawCards() {
    let list = cards;
    if (cardListState.q) list = list.filter(c => (c.front + ' ' + c.back).includes(cardListState.q));
    if (cardListState.favOnly) list = list.filter(c => c.favorite);
    $('#cardList').innerHTML = list.length ? list.map(c => `
      <div class="cardrow" data-id="${c.id}">
        <button class="fav" aria-pressed="${c.favorite}" aria-label="تفضيل الكارت"><span class="ms" aria-hidden="true">favorite</span></button>
        <div class="q"><b>${esc(c.front)}</b><small>${esc(c.back)}</small></div>
        <span class="badge" title="المراجعة القادمة">${c.state === 'new' ? 'جديد' : relDue(c.nextReview)}</span>
        <div class="ops">
          <a class="icon-btn" href="#/editor/${deckId}/${c.id}" aria-label="تعديل الكارت"><span class="ms" aria-hidden="true">edit</span></a>
          <button class="icon-btn danger del-card" aria-label="حذف الكارت"><span class="ms" aria-hidden="true">delete</span></button>
        </div>
      </div>`).join('')
      : emptyState('style', cards.length ? 'لا نتائج مطابقة' : 'لا كروت بعد', cards.length ? 'عدّل البحث.' : 'أضف أول كارت لهذه المجموعة.', cards.length ? '' : `<a class="btn" href="#/editor/${deckId}">إضافة كارت</a>`);

    $$('#cardList .fav').forEach(b => b.addEventListener('click', () => {
      const c = Store.card(b.closest('.cardrow').dataset.id);
      Store.updateCard(c.id, { favorite: !c.favorite });
      b.setAttribute('aria-pressed', String(c.favorite));
    }));
    $$('#cardList .del-card').forEach(b => b.addEventListener('click', () => {
      const id = b.closest('.cardrow').dataset.id;
      confirmDlg('حذف الكارت', 'سيُحذف هذا الكارت وسجل مراجعاته نهائيًا.', 'حذف', () => {
        Store.deleteCard(id); toast('تم حذف الكارت'); router();
      });
    }));
  }
  drawCards();

  $('#cq').addEventListener('input', e => { cardListState.q = e.target.value.trim(); drawCards(); });
  $('#favOnly').addEventListener('click', e => { cardListState.favOnly = !cardListState.favOnly; e.currentTarget.setAttribute('aria-pressed', String(cardListState.favOnly)); drawCards(); });
  $('#editDeck').addEventListener('click', () => deckFormDlg(deck));
  $('#dupDeck').addEventListener('click', () => {
    const copy = Store.duplicateDeck(deckId);
    toast('تم إنشاء نسخة من المجموعة'); location.hash = `#/deck/${copy.id}`;
  });
  $('#delDeck').addEventListener('click', () => {
    confirmDlg('حذف المجموعة', `ستُحذف «${deck.name}» وكل كروتها (${cards.length}) وسجلاتها نهائيًا.`, 'حذف نهائي', () => {
      Store.deleteDeck(deckId); toast('تم حذف المجموعة'); location.hash = '#/decks';
    });
  });
  $('#expDeck').addEventListener('click', () => exportDeckDlg(deck));
}

/* ============================================================
   4) محرر الكروت
   ============================================================ */
function renderEditor(main, deckId, cardId) {
  const deck = Store.deck(deckId);
  if (!deck) { main.innerHTML = emptyState('warning', 'المجموعة غير موجودة', '', `<a class="btn" href="#/decks">العودة</a>`); return; }
  const editing = cardId ? Store.card(cardId) : null;

  main.innerHTML = `
    <a class="lnk" href="#/deck/${deckId}" style="min-block-size:auto">← ${esc(deck.name)}</a>
    <div class="sec-head"><h2>${editing ? 'تعديل كارت' : 'إضافة كارت جديد'}</h2></div>
    <div class="editor-grid">
      <form id="cardForm" class="card" style="margin:0;display:grid;gap:var(--sp-4)">
        <label>الوجه الأمامي — السؤال أو المصطلح
          <textarea name="front" required rows="4" maxlength="2000" placeholder="اكتب السؤال هنا… يمكنك استخدام أسطر متعددة ورموز رياضية مثل ‎\(x^2 + y^2 = r^2\)‎">${esc(editing?.front || '')}</textarea>
        </label>
        <label>الوجه الخلفي — الإجابة أو الشرح
          <textarea name="back" required rows="5" maxlength="4000" placeholder="اكتب الإجابة أو الشرح…">${esc(editing?.back || '')}</textarea>
        </label>
        <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="favorite" ${editing?.favorite ? 'checked' : ''}> إضافة للمفضلة</label>
        <div class="fieldmsg" id="cardErr"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" type="submit">${editing ? 'حفظ التعديلات' : 'حفظ وإضافة التالي'}</button>
          <a class="btn g" href="#/deck/${deckId}">إنهاء والعودة</a>
        </div>
      </form>
      <div class="preview-stage">
        <p class="hint" style="margin-block-end:8px">معاينة مباشرة</p>
        <div class="mini-fc"><small>الوجه الأمامي</small><div class="t" id="pvF">${esc(editing?.front || '…')}</div></div>
        <div style="text-align:center;color:var(--mut);margin-block:6px"><span class="ms" aria-hidden="true">flip</span></div>
        <div class="mini-fc" style="background:var(--cream)"><small>الوجه الخلفي</small><div class="t" id="pvB">${esc(editing?.back || '…')}</div></div>
      </div>
    </div>`;

  const form = $('#cardForm');
  form.front.addEventListener('input', () => $('#pvF').textContent = form.front.value || '…');
  form.back.addEventListener('input', () => $('#pvB').textContent = form.back.value || '…');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const front = form.front.value.trim(), back = form.back.value.trim();
    if (!front || !back) { $('#cardErr').textContent = 'وجها الكارت مطلوبان.'; return; }
    if (editing) {
      Store.updateCard(editing.id, { front, back, favorite: form.favorite.checked });
      toast('تم حفظ الكارت'); location.hash = `#/deck/${deckId}`;
    } else {
      Store.addCard(deckId, { front, back, favorite: form.favorite.checked });
      toast('تمت إضافة الكارت — أضف التالي');
      form.reset(); form.front.focus(); $('#pvF').textContent = $('#pvB').textContent = '…';
    }
  });
}

/* ============================================================
   5) جلسة المراجعة (Study Session)
   - كروت مستحقة فقط افتراضيًا، أو يدوية شاملة ?mode=all
   - قلب سلس، تقييم Again/Hard/Good/Easy، منع الضغط المتكرر،
     حفظ تلقائي لكل مراجعة لحظة حدوثها (لا فقدان عند الانقطاع).
   ============================================================ */
const Study = {
  queue: [], idx: 0, deckId: null, manual: false, session: null,
  counts: { again: 0, hard: 0, good: 0, easy: 0 }, answered: 0, busy: false, _key: null,

  teardown() {
    if (this._key) { document.removeEventListener('keydown', this._key); this._key = null; }
    this.busy = false;
  },

  start(deckId, manual) {
    this.deckId = deckId; this.manual = manual;
    this.queue = SRS.dueCards(deckId, manual);
    this.idx = 0; this.answered = 0;
    this.counts = { again: 0, hard: 0, good: 0, easy: 0 };
    this.session = Store.addSession({ deckId: deckId || null, manual, reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 });
  },

  current() {
    const c = this.queue[this.idx];
    return c ? Store.card(c.id) : null;
  },
};

function renderStudy(main, deckId, _p, query) {
  const manual = query?.get('mode') === 'all';
  const deck = deckId ? Store.deck(deckId) : null;
  if (deckId && !deck) { main.innerHTML = emptyState('warning', 'المجموعة غير موجودة', '', `<a class="btn" href="#/decks">العودة</a>`); return; }

  Study.start(deckId, manual);

  if (!Study.queue.length) {
    main.innerHTML = emptyState('check', manual ? 'لا توجد كروت في هذا النطاق' : 'لا توجد كروت مستحقة الآن 🎉',
      manual ? 'أضف كروتًا أولًا.' : 'كل كروتك مجدولة لمواعيد قادمة. يمكنك مراجعة يدوية شاملة إن رغبت.',
      `<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <a class="btn g" href="${deck ? `#/deck/${deck.id}` : '#/dashboard'}">العودة</a>
        ${!manual ? `<a class="btn" href="#/study/${deckId || ''}?mode=all">مراجعة يدوية شاملة</a>` : ''}
      </div>`);
    return;
  }

  main.innerHTML = `
    <div class="study-wrap">
      <div class="study-bar">
        <a class="icon-btn" href="${deck ? `#/deck/${deck.id}` : '#/dashboard'}" aria-label="إنهاء الجلسة"><span class="ms" aria-hidden="true">close</span></a>
        <div class="bar"><i id="stProg"></i></div>
        <span id="stCount" class="tldraw"></span>
        ${manual ? '<span class="badge gold">مراجعة يدوية</span>' : ''}
      </div>
      <div class="fc-stage" id="fcStage" role="button" tabindex="0" aria-label="اقلب الكارت">
        <div class="fc" id="fc">
          <div class="fc-face front">
            <span class="lbl"><span class="ms" aria-hidden="true">help</span> السؤال</span>
            <div class="txt" id="fcFront"></div>
            <span class="hint-flip"><span class="kbd">مسافة</span> اضغط لقلب الكارت</span>
          </div>
          <div class="fc-face back">
            <span class="lbl"><span class="ms" aria-hidden="true">visibility</span> الإجابة</span>
            <div class="txt" id="fcBack"></div>
          </div>
        </div>
      </div>
      <button class="btn flip-btn" id="flipBtn"><span class="ms" aria-hidden="true">flip</span>إظهار الإجابة</button>
      <div class="rate" id="rate" hidden>
        <button class="r1" data-r="again"><b>Again</b><small>لم أتذكر</small></button>
        <button class="r2" data-r="hard"><b>Hard</b><small>بصعوبة</small></button>
        <button class="r3" data-r="good"><b>Good</b><small>تذكرت</small></button>
        <button class="r4" data-r="easy"><b>Easy</b><small>بسهولة</small></button>
      </div>
    </div>`;

  const fc = $('#fc'), stage = $('#fcStage'), flipBtn = $('#flipBtn'), rate = $('#rate');
  let flipped = false;

  function draw() {
    const c = Study.current();
    if (!c) return summary();
    flipped = false;
    fc.classList.remove('flipped');
    rate.hidden = true; flipBtn.hidden = false;
    $('#fcFront').textContent = c.front;
    $('#fcBack').textContent = c.back;
    $('#stCount').textContent = `${Study.idx + 1} / ${Study.queue.length}`;
    $('#stProg').style.inlineSize = `${Math.min(100, Math.round(Study.answered / Study.queue.length * 100))}%`;
  }

  function flip() {
    if (flipped) return;
    flipped = true;
    fc.classList.add('flipped');
    flipBtn.hidden = true; rate.hidden = false;
    $('.rate button', rate)?.focus?.();
  }

  function answer(ratingKey, btn) {
    if (!flipped || Study.busy) return;
    Study.busy = true; /* منع تسجيل مراجعة مكررة بالضغط المتكرر */
    $$('.rate button', rate).forEach(b => b.disabled = true);

    const c = Study.current();
    const patch = SRS.review(c, ratingKey);
    Study.counts[ratingKey]++; Study.answered++;

    /* الكروت المنسية تعود داخل الجلسة نفسها */
    if (ratingKey === 'again' && Study.idx === Study.queue.length - 1) Study.queue.push(Store.card(c.id));
    else if (ratingKey === 'again') Study.queue.splice(Math.min(Study.idx + 3, Study.queue.length), 0, Store.card(c.id));

    Store.updateSession(Study.session.id, {
      reviewed: Study.answered, again: Study.counts.again, hard: Study.counts.hard,
      good: Study.counts.good, easy: Study.counts.easy, endedAt: Date.now(),
    });

    setTimeout(() => {
      Study.idx++;
      Study.busy = false;
      $$('.rate button', rate).forEach(b => b.disabled = false);
      draw();
    }, 180);
  }

  stage.addEventListener('click', flip);
  flipBtn.addEventListener('click', flip);
  $$('.rate button', rate).forEach(b => b.addEventListener('click', () => answer(b.dataset.r, b)));

  Study._key = e => {
    if (e.key === ' ' || e.key === 'Enter') { if (document.activeElement?.closest('.rate')) return; e.preventDefault(); flipped ? null : flip(); }
    if (!flipped) return;
    const map = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
    if (map[e.key]) answer(map[e.key]);
  };
  document.addEventListener('keydown', Study._key);

  function summary() {
    Study.teardown();
    const t = Study.counts, total = Study.answered;
    const goodRate = total ? Math.round(((t.good + t.easy) / total) * 100) : 0;
    main.innerHTML = `
      <div class="study-wrap">
        <div class="card sum-hero">
          <span class="ms" aria-hidden="true">emoji_events</span>
          <h2>انتهت الجلسة!</h2>
          <p style="color:var(--mut)">راجعت ${fmtNum(total)} كارت${deck ? ` من «${esc(deck.name)}»` : ''}.</p>
          <div class="sum-grid">
            <div class="cream"><b style="font:700 1.5rem var(--serif);color:var(--err)">${fmtNum(t.again)}</b><br>Again</div>
            <div class="cream"><b style="font:700 1.5rem var(--serif);color:var(--amber)">${fmtNum(t.hard)}</b><br>Hard</div>
            <div class="cream"><b style="font:700 1.5rem var(--serif);color:var(--primary-c)">${fmtNum(t.good)}</b><br>Good</div>
            <div class="cream"><b style="font:700 1.5rem var(--serif);color:var(--lime)">${fmtNum(t.easy)}</b><br>Easy</div>
          </div>
          <p>معدل التذكر في الجلسة: <b>${fmtNum(goodRate)}٪</b></p>
          ${bar(goodRate)}
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-block-start:var(--sp-6)">
            <a class="btn" href="${deck ? `#/deck/${deck.id}` : '#/dashboard'}">العودة</a>
            <a class="btn g" href="#/stats">عرض الإحصائيات</a>
          </div>
        </div>
      </div>`;
  }

  draw();
}

/* ============================================================
   6) تقويم المراجعات
   ============================================================ */
function renderCalendar(main) {
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + calOffset);
  const y = base.getFullYear(), m = base.getMonth();
  const monthName = new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric' }).format(base);
  const firstDay = new Date(y, m, 1);
  const startDow = (firstDay.getDay() + 1) % 7; /* السبت أول الأسبوع */
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStart = startOfDay();

  let cells = '';
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-day out" aria-hidden="true"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = new Date(y, m, d).getTime();
    const due = Store.data.cards.filter(c => c.nextReview >= ds && c.nextReview < ds + DAY).length;
    const done = SRS.reviewedOn(ds).length;
    cells += `
      <div class="cal-day ${ds === todayStart ? 'today' : ''}" aria-label="${d} — ${fmtNum(due)} مستحق، ${fmtNum(done)} مراجعة">
        <span class="n">${fmtNum(d)}</span>
        <div class="cal-dots">
          ${due ? `<span class="dot-pill due" title="مستحق">${fmtNum(due)} مستحق</span>` : ''}
          ${done ? `<span class="dot-pill done" title="تمت مراجعته">${fmtNum(done)} ✓</span>` : ''}
        </div>
      </div>`;
  }

  const sessions = Store.data.sessions.slice().sort((a, b) => b.startedAt - a.startedAt).slice(0, 12);

  main.innerHTML = `
    <div class="card">
      <div class="cal-head">
        <button class="btn g s" id="calPrev" aria-label="الشهر السابق"><span class="ms" aria-hidden="true">chevron_right</span></button>
        <h2>${monthName}</h2>
        <button class="btn g s" id="calNext" aria-label="الشهر التالي"><span class="ms" aria-hidden="true">chevron_left</span></button>
      </div>
      <div class="cal-grid">
        ${['سبت', 'أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'].map(d => `<span class="dow">${d}</span>`).join('')}
        ${cells}
      </div>
    </div>
    <div class="sec-head"><h2>سجل جلسات المراجعة</h2></div>
    <div class="session-log">
      ${sessions.length ? sessions.map(s => {
        const deck = s.deckId ? Store.deck(s.deckId) : null;
        const good = s.reviewed ? Math.round(((s.good + s.easy) / s.reviewed) * 100) : 0;
        return `<div class="row">
          <span class="ms" aria-hidden="true">timer</span>
          <div><b>${esc(deck?.name || 'كل المجموعات')}</b> ${s.manual ? '<span class="badge gold">يدوية</span>' : ''}<br>
          <small>${fmtDate(s.startedAt)} · ${fmtTime(s.startedAt)}</small></div>
          <b>${fmtNum(s.reviewed)} كارت · ${fmtNum(good)}٪ تذكر</b>
        </div>`;
      }).join('') : emptyState('calendar_month', 'لا جلسات بعد', 'ابدأ أول جلسة مراجعة وستظهر هنا.')}
    </div>`;

  $('#calPrev').addEventListener('click', () => { calOffset--; router(); });
  $('#calNext').addEventListener('click', () => { calOffset++; router(); });
}

/* ============================================================
   7) الإحصائيات
   ============================================================ */
function renderStats(main) {
  const reviews = Store.data.reviews;
  const total = reviews.length;
  const good = reviews.filter(r => r.rating === 'good' || r.rating === 'easy').length;
  const retention = total ? Math.round((good / total) * 100) : 0;

  /* آخر 14 يومًا */
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = startOfDay() - i * DAY;
    days.push({ d, label: new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'numeric' }).format(new Date(d)), n: SRS.reviewedOn(d).length });
  }
  const max = Math.max(1, ...days.map(x => x.n));

  /* أكثر المواد مراجعة */
  const bySubject = {};
  for (const r of reviews) {
    const c = Store.card(r.cardId);
    const sub = (c && Store.deck(c.deckId)?.subject) || 'عام';
    bySubject[sub] = (bySubject[sub] || 0) + 1;
  }
  const subs = Object.entries(bySubject).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const subMax = Math.max(1, ...subs.map(s => s[1]));

  /* توزيع التقييمات */
  const rCounts = { again: 0, hard: 0, good: 0, easy: 0 };
  reviews.forEach(r => rCounts[r.rating]++);

  main.innerHTML = `
    <div class="stats">
      ${statTile('check', 'إجمالي المراجعات', fmtNum(total))}
      ${statTile('grade', 'معدل التذكر', fmtNum(retention) + '٪', 'gold')}
      ${statTile('style', 'الكروت النشطة', fmtNum(Store.data.cards.length))}
      ${statTile('timer', 'جلسات المراجعة', fmtNum(Store.data.sessions.length))}
    </div>

    <div class="card">
      <h2 style="font-size:var(--fs-20)">المراجعات — آخر 14 يومًا</h2>
      <div class="chart" role="img" aria-label="رسم بياني للمراجعات اليومية">
        ${days.map(x => `<div class="colb" title="${x.label}: ${fmtNum(x.n)}"><i style="block-size:${Math.round(x.n / max * 100)}%"></i><span>${x.label}</span></div>`).join('')}
      </div>
    </div>

    <div class="g2">
      <div class="card" style="margin:0">
        <h2 style="font-size:var(--fs-20)">توزيع التقييمات</h2>
        <div class="legend">
          <span><i style="background:var(--err)"></i>Again — ${fmtNum(rCounts.again)}</span>
          <span><i style="background:var(--amber)"></i>Hard — ${fmtNum(rCounts.hard)}</span>
          <span><i style="background:var(--primary-c)"></i>Good — ${fmtNum(rCounts.good)}</span>
          <span><i style="background:var(--lime)"></i>Easy — ${fmtNum(rCounts.easy)}</span>
        </div>
      </div>
      <div class="card" style="margin:0">
        <h2 style="font-size:var(--fs-20)">المواد الأكثر مراجعة</h2>
        ${subs.length ? subs.map(([s, n]) => `
          <div style="margin-block-end:10px"><div style="display:flex;justify-content:space-between;font-size:var(--fs-14)"><b>${esc(s)}</b><span>${fmtNum(n)}</span></div>${bar(Math.round(n / subMax * 100))}</div>
        `).join('') : '<p class="hint">لا بيانات بعد.</p>'}
      </div>
    </div>`;
}

/* ============================================================
   8) الإعدادات
   ============================================================ */
function renderSettings(main) {
  const s = Store.settings();
  main.innerHTML = `
    <div class="card">
      <h2 style="font-size:var(--fs-20)">المراجعة اليومية</h2>
      <div class="set-row">
        <div class="lbl"><b>حد الكروت الجديدة يوميًا</b><small>أقصى عدد كروت جديدة تدخل جلسة اليوم</small></div>
        <input type="number" id="setNew" min="1" max="200" value="${s.dailyNew}">
      </div>
      <div class="set-row">
        <div class="lbl"><b>حد المراجعات اليومية</b><small>أقصى عدد مراجعات في الجلسة الواحدة</small></div>
        <input type="number" id="setRev" min="10" max="500" step="10" value="${s.dailyReview}">
      </div>
    </div>

    <div class="card">
      <h2 style="font-size:var(--fs-20)">الإشعارات</h2>
      <div class="set-row">
        <div class="lbl"><b>تذكير يومي بالمراجعة</b><small>إشعار المتصفح في الموعد المحدد أثناء فتح التطبيق</small></div>
        <span class="switch"><input type="checkbox" id="setNotif" ${s.notifEnabled ? 'checked' : ''}><i></i></span>
      </div>
      <div class="set-row">
        <div class="lbl"><b>موعد التذكير</b><small>بتوقيت جهازك</small></div>
        <input type="time" id="setNotifTime" value="${esc(s.notifTime)}" style="inline-size:140px">
      </div>
    </div>

    <div class="card">
      <h2 style="font-size:var(--fs-20)">تفضيلات العرض</h2>
      <div class="set-row">
        <div class="lbl"><b>المظهر</b><small>فاتح، داكن، أو تلقائي حسب النظام</small></div>
        <select id="setTheme" style="inline-size:150px">
          <option value="auto" ${s.theme === 'auto' ? 'selected' : ''}>تلقائي</option>
          <option value="light" ${s.theme === 'light' ? 'selected' : ''}>فاتح</option>
          <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>داكن</option>
        </select>
      </div>
    </div>

    <div class="card">
      <h2 style="font-size:var(--fs-20)">البيانات</h2>
      <div class="set-row">
        <div class="lbl"><b>نسخة احتياطية كاملة</b><small>تصدير كل المجموعات والكروت والسجلات بصيغة JSON</small></div>
        <button class="btn g" id="backupBtn"><span class="ms" aria-hidden="true">download</span>تصدير الكل</button>
      </div>
      <div class="set-row">
        <div class="lbl"><b>استعادة نسخة احتياطية</b><small>تستبدل البيانات الحالية</small></div>
        <button class="btn g" id="restoreBtn"><span class="ms" aria-hidden="true">upload</span>استعادة</button>
      </div>
      <div class="set-row">
        <div class="lbl"><b style="color:var(--err)">مسح كل البيانات</b><small>حذف نهائي لكل المجموعات والكروت والسجلات من هذا الجهاز</small></div>
        <button class="btn d" id="wipeBtn"><span class="ms" aria-hidden="true">delete</span>مسح الكل</button>
      </div>
      <p class="hint" style="margin-block-start:var(--sp-4)">ملاحظة: النسخة الحالية تحفظ بياناتك محليًا في متصفحك (localStorage) وتعمل دون إنترنت. ربط قاعدة بيانات Supabase جاهز للتفعيل عبر <code>supabase-schema.sql</code> بعد مراجعة مسؤول المنظومة.</p>
    </div>`;

  $('#setNew').addEventListener('change', e => { Store.saveSettings({ dailyNew: Math.max(1, +e.target.value || 20) }); toast('تم الحفظ'); });
  $('#setRev').addEventListener('change', e => { Store.saveSettings({ dailyReview: Math.max(10, +e.target.value || 100) }); toast('تم الحفظ'); });
  $('#setTheme').addEventListener('change', e => { Store.saveSettings({ theme: e.target.value }); applyTheme(); toast('تم الحفظ'); });
  $('#setNotifTime').addEventListener('change', e => { Store.saveSettings({ notifTime: e.target.value }); toast('تم الحفظ'); });

  $('#setNotif').addEventListener('change', async e => {
    if (!e.target.checked) { Store.saveSettings({ notifEnabled: false }); Notifier.stop(); toast('أُوقف التذكير'); return; }
    if (!('Notification' in window)) { toast('المتصفح لا يدعم الإشعارات'); e.target.checked = false; return; }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') { Store.saveSettings({ notifEnabled: true }); Notifier.schedule(); toast('فُعّل التذكير اليومي'); }
    else { toast('رُفض إذن الإشعارات من المتصفح'); e.target.checked = false; }
  });

  $('#backupBtn').addEventListener('click', () => {
    download(`ilogia-cards-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ app: 'ilogia-cards', version: 1, exportedAt: new Date().toISOString(), data: Store.data }, null, 2), 'application/json');
    toast('تم تنزيل النسخة الاحتياطية');
  });

  $('#restoreBtn').addEventListener('click', () => pickFile('.json', file => {
    readJson(file).then(obj => {
      if (obj?.app !== 'ilogia-cards' || !obj.data?.decks) throw new Error('bad');
      confirmDlg('استعادة نسخة احتياطية', 'ستستبدل هذه العملية كل بياناتك الحالية على هذا الجهاز.', 'استعادة', () => {
        Store.data = obj.data; Store.save(); applyTheme(); router(); toast('تمت الاستعادة بنجاح');
      });
    }).catch(() => toast('ملف غير صالح — تأكد من أنه نسخة احتياطية من iLogia Cards'));
  }));

  $('#wipeBtn').addEventListener('click', () => {
    confirmDlg('مسح كل البيانات', 'سيفقد كل شيء: المجموعات، الكروت، سجلات المراجعة، والإعدادات. لا يمكن التراجع.', 'مسح نهائي', () => {
      localStorage.removeItem(LS_KEY); Store.load(); applyTheme(); router(); toast('تم مسح جميع البيانات');
    });
  });
}

/* تذكير يومي بسيط أثناء فتح التطبيق */
const Notifier = {
  t: null,
  schedule() {
    this.stop();
    const s = Store.settings();
    if (!s.notifEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
    const [h, m] = (s.notifTime || '18:00').split(':').map(Number);
    const next = new Date(); next.setHours(h, m, 0, 0);
    if (next <= new Date()) next.setDate(next.getDate() + 1);
    this.t = setTimeout(() => {
      const due = SRS.dueCount();
      if (due) new Notification('iLogia Cards', { body: `لديك ${due} كارت مستحق للمراجعة اليوم.` });
      this.schedule();
    }, next - new Date());
  },
  stop() { clearTimeout(this.t); },
};

/* ============================================================
   الاستيراد والتصدير
   ============================================================ */
function download(name, content, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function pickFile(accept, cb) {
  const inp = $('#filePick');
  inp.value = ''; inp.accept = accept;
  inp.onchange = () => { if (inp.files[0]) cb(inp.files[0]); };
  inp.click();
}
const readJson = f => f.text().then(JSON.parse);
const csvEsc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

function exportDeckDlg(deck) {
  openDlg(`
    <h2 id="dlgTitle">تصدير «${esc(deck.name)}»</h2>
    <p style="color:var(--mut)">اختر الصيغة المناسبة:</p>
    <div style="display:grid;gap:8px">
      <button class="btn" id="expJson"><span class="ms" aria-hidden="true">download</span>JSON — يشمل حالة التكرار المتباعد</button>
      <button class="btn g" id="expCsv"><span class="ms" aria-hidden="true">download</span>CSV — سؤال/جواب فقط (Excel)</button>
    </div>`);
  $('#expJson').onclick = () => {
    const cards = Store.deckCards(deck.id);
    download(`${deck.name}.json`, JSON.stringify({ app: 'ilogia-cards', kind: 'deck', version: 1, deck, cards }, null, 2), 'application/json');
    closeDlg(); toast('تم تصدير المجموعة (JSON)');
  };
  $('#expCsv').onclick = () => {
    const cards = Store.deckCards(deck.id);
    const csv = '﻿' + ['front,back,favorite', ...cards.map(c => [csvEsc(c.front), csvEsc(c.back), c.favorite ? 1 : 0].join(','))].join('\n');
    download(`${deck.name}.csv`, csv, 'text/csv');
    closeDlg(); toast('تم تصدير المجموعة (CSV)');
  };
}

function parseCsv(text) {
  /* محلل CSV بسيط يدعم الحقول المقتبسة */
  const rows = []; let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

function importDeckDlg() {
  openDlg(`
    <h2 id="dlgTitle">استيراد مجموعة</h2>
    <p style="color:var(--mut)">يدعم ملفات <b>JSON</b> المُصدّرة من iLogia Cards، وملفات <b>CSV</b> بعمودين: السؤال ثم الإجابة (مع سطر عناوين اختياري).</p>
    <button class="btn" id="pickImp" style="inline-size:100%"><span class="ms" aria-hidden="true">file_upload</span>اختيار ملف (.json / .csv)</button>
    <div class="fieldmsg" id="impErr"></div>`);
  $('#pickImp').onclick = () => pickFile('.json,.csv', async file => {
    try {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith('.json')) {
        const obj = JSON.parse(text);
        if (obj?.app !== 'ilogia-cards' || obj.kind !== 'deck' || !obj.deck || !Array.isArray(obj.cards)) throw new Error('bad');
        const d = Store.addDeck({ name: obj.deck.name + ' (مستوردة)', subject: obj.deck.subject, grade: obj.deck.grade, description: obj.deck.description, color: obj.deck.color });
        obj.cards.forEach(c => { if (c.front && c.back) Store.addCard(d.id, { front: String(c.front), back: String(c.back), favorite: !!c.favorite }); });
        closeDlg(); toast('تم الاستيراد بنجاح'); location.hash = `#/deck/${d.id}`;
      } else {
        const rows = parseCsv(text.replace(/^﻿/, ''));
        const start = rows.length && /front|سؤال|question/i.test(rows[0][0] || '') ? 1 : 0;
        const pairs = rows.slice(start).map(r => ({ front: (r[0] || '').trim(), back: (r[1] || '').trim() })).filter(p => p.front && p.back);
        if (!pairs.length) throw new Error('bad');
        const d = Store.addDeck({ name: file.name.replace(/\.csv$/i, ''), subject: '', grade: '', description: 'مستوردة من CSV', color: DECK_COLORS[0] });
        pairs.forEach(p => Store.addCard(d.id, p));
        closeDlg(); toast(`تم استيراد ${fmtNum(pairs.length)} كارت`); location.hash = `#/deck/${d.id}`;
      }
    } catch { $('#impErr').textContent = 'تعذر قراءة الملف — تحقق من الصيغة وحاول مجددًا.'; }
  });
}

/* ============================================================
   الإقلاع
   ============================================================ */
Store.load();
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
Notifier.schedule();
if (!location.hash) location.replace('#/dashboard');
router();
