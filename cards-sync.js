// iLogia Cards — مزامنة مع Supabase (local-first) باستخدام جلسة الدخول الموحد (ilogia-sso.js).
// - لو مفيش تسجيل دخول: التطبيق يشتغل محليًا زي ما هو.
// - لو الجداول (supabase-schema.sql) لسه متعملتش: يفضل محلي ومفيش أي خطأ للمستخدم.
// - ملاحظة: البيانات المحلية القديمة (قبل تسجيل الدخول) بتتدمج مع حسابك أول مرة (union) ومبتتمسحش.
import { ssoAuth } from './ilogia-sso.js';

const SUPABASE_URL = 'https://zugwicbbfbefbbwugfxq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_34jNpaqwtFeYboTVgO-mYw_efc0T-Ew';   // publishable فقط
const LS_KEY = 'ilogia_cards_v1', OWNER_KEY = 'ilogia_cards_owner', DIRTY_KEY = 'ilogia_cards_dirty';
const T = { decks: 'flashcard_decks', cards: 'flashcards', reviews: 'flashcard_reviews', sessions: 'flashcard_study_sessions', settings: 'flashcard_user_settings' };
const UPSERT_ORDER = ['decks', 'cards', 'reviews', 'sessions'];
const DELETE_ORDER = ['sessions', 'reviews', 'cards', 'decks'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---------- أدوات ---------- */
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const int = (v, min, max, d = min) => Math.min(max, Math.max(min, Math.round(num(v, d))));
const str = (v, max) => String(v ?? '').slice(0, max);
const iso = (ms) => new Date(Number.isFinite(Number(ms)) && Number(ms) > 0 ? Number(ms) : Date.now()).toISOString();
const ms = (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : Date.now(); };
const hhmm = (v, fb) => (/^\d{1,2}:\d{2}/.test(v || '') ? String(v).slice(0, 5).padStart(5, '0') : fb);
const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
const ck = ({ error }) => { if (error) throw error; };
const missing = (e) => !!e && (['42P01', 'PGRST205', 'PGRST202'].includes(e.code) || /does not exist|schema cache|could not find the table/i.test(e.message || ''));
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } }, del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } } };
const hasContent = (d) => ['decks', 'cards', 'reviews', 'sessions'].some((k) => (d[k] || []).length);

/* ---------- ids القديمة -> UUID ---------- */
function ensureUuids(d) {
  const map = new Map();
  const nid = (old) => { if (old == null || UUID_RE.test(old)) return old; if (!map.has(old)) map.set(old, uuid()); return map.get(old); };
  d.decks.forEach((x) => { x.id = nid(x.id); });
  d.cards.forEach((x) => { x.id = nid(x.id); x.deckId = nid(x.deckId); });
  d.reviews.forEach((x) => { x.id = nid(x.id); x.cardId = nid(x.cardId); if (x.deckId) x.deckId = nid(x.deckId); });
  d.sessions.forEach((x) => { x.id = nid(x.id); if (x.deckId) x.deckId = nid(x.deckId); });
}

/* ---------- local -> rows ---------- */
export function toRows(d, userId) {
  const r = { decks: [], cards: [], reviews: [], sessions: [], settings: null };
  const deckIds = new Set(), cardIds = new Set();
  for (const x of d.decks) { deckIds.add(x.id); r.decks.push({ id: x.id, user_id: userId, name: str(x.name, 80) || '—', subject: str(x.subject, 200), grade: str(x.grade, 200), description: str(x.description, 2000), color: str(x.color, 20) || '#136F58', created_at: iso(x.createdAt), updated_at: iso(x.updatedAt) }); }
  for (const c of d.cards) {
    const front = str(c.front, 2000), back = str(c.back, 4000);
    if (!deckIds.has(c.deckId) || !front || !back) continue;
    cardIds.add(c.id);
    r.cards.push({ id: c.id, user_id: userId, deck_id: c.deckId, front, back, favorite: !!c.favorite, ease: Math.max(1.3, num(c.ease, 2.5)), interval: int(c.interval, 0, 100000, 0), reps: int(c.reps, 0, 1e6, 0), lapses: int(c.lapses, 0, 1e6, 0), state: ['new', 'learning', 'review', 'relearning'].includes(c.state) ? c.state : 'new', difficulty: num(c.difficulty, 0), next_review: iso(c.nextReview), created_at: iso(c.createdAt), updated_at: iso(c.updatedAt) });
  }
  for (const v of d.reviews) {
    if (!cardIds.has(v.cardId) || !['again', 'hard', 'good', 'easy'].includes(v.rating)) continue;
    r.reviews.push({ id: v.id, user_id: userId, card_id: v.cardId, rating: v.rating, next_due: iso(v.nextDue), reviewed_at: iso(v.reviewedAt) });
  }
  for (const s of d.sessions) r.sessions.push({ id: s.id, user_id: userId, deck_id: deckIds.has(s.deckId) ? s.deckId : null, manual: !!s.manual, reviewed: int(s.reviewed, 0, 1e6, 0), again: int(s.again, 0, 1e6, 0), hard: int(s.hard, 0, 1e6, 0), good: int(s.good, 0, 1e6, 0), easy: int(s.easy, 0, 1e6, 0), started_at: iso(s.startedAt), ended_at: s.endedAt ? iso(s.endedAt) : null });
  const st = d.settings || {};
  r.settings = { user_id: userId, daily_new: int(st.dailyNew, 1, 200, 20), daily_review: int(st.dailyReview, 10, 500, 100), theme: ['auto', 'light', 'dark'].includes(st.theme) ? st.theme : 'auto', notif_enabled: !!st.notifEnabled, notif_time: hhmm(st.notifTime, '18:00') };
  return r;
}

/* ---------- rows -> local ---------- */
export function fromRemote(r) {
  const deckOf = new Map((r.cards || []).map((c) => [c.id, c.deck_id]));
  const out = {
    decks: (r.decks || []).map((x) => ({ id: x.id, name: x.name, subject: x.subject, grade: x.grade, description: x.description, color: x.color, createdAt: ms(x.created_at), updatedAt: ms(x.updated_at) })).sort((a, b) => a.createdAt - b.createdAt),
    cards: (r.cards || []).map((c) => ({ id: c.id, deckId: c.deck_id, front: c.front, back: c.back, favorite: !!c.favorite, createdAt: ms(c.created_at), updatedAt: ms(c.updated_at), difficulty: Number(c.difficulty), nextReview: ms(c.next_review), ease: Number(c.ease), interval: c.interval, reps: c.reps, lapses: c.lapses, state: c.state })),
    reviews: (r.reviews || []).map((v) => ({ id: v.id, cardId: v.card_id, deckId: deckOf.get(v.card_id) || null, rating: v.rating, nextDue: ms(v.next_due), reviewedAt: ms(v.reviewed_at) })).sort((a, b) => a.reviewedAt - b.reviewedAt),
    sessions: (r.sessions || []).map((s) => ({ id: s.id, deckId: s.deck_id, manual: !!s.manual, reviewed: s.reviewed, again: s.again, hard: s.hard, good: s.good, easy: s.easy, startedAt: ms(s.started_at), ...(s.ended_at ? { endedAt: ms(s.ended_at) } : {}) })).sort((a, b) => a.startedAt - b.startedAt),
  };
  const s = r.settings;
  if (s) out.settings = { dailyNew: s.daily_new, dailyReview: s.daily_review, theme: s.theme, notifEnabled: !!s.notif_enabled, notifTime: String(s.notif_time).slice(0, 5) };
  return out;
}

/* ---------- المحرّك ---------- */
const listeners = new Set();
export const sync = { status: 'local', on(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
function setStatus(s, info) { sync.status = s; listeners.forEach((f) => { try { f(s, info); } catch { /* ignore */ } }); }

let active = null;
const idsOf = (rows) => { const k = {}; DELETE_ORDER.forEach((t) => { k[t] = new Set((rows[t] || []).map((x) => x.id)); }); return k; };

async function fetchAll(a) {
  const keys = Object.keys(T);
  const res = await Promise.all(keys.map((k) => a.client.from(T[k]).select('*')));
  const out = {};
  for (let i = 0; i < keys.length; i++) { const { data, error } = res[i]; if (error) { if (missing(error)) return null; throw error; } out[keys[i]] = data || []; }
  out.settings = out.settings[0] || null;
  return out;
}
const isEmptyRemote = (r) => !r.settings && DELETE_ORDER.every((t) => !r[t].length);

async function pushNow(a) {
  if (active !== a) return;
  if (a.running) { a.dirty = true; return; }
  a.running = true; a.dirty = false; setStatus('syncing');
  try {
    const d = a.store.data; ensureUuids(d); a.store.save(true);
    const rows = toRows(d, a.userId), cur = idsOf(rows), sent = new Map();
    for (const k of UPSERT_ORDER) {
      const changed = rows[k].filter((x) => { const h = JSON.stringify(x); sent.set(k + ':' + x.id, h); return a.sent.get(k + ':' + x.id) !== h; });
      for (const part of chunk(changed, 500)) ck(await a.client.from(T[k]).upsert(part, { onConflict: 'id' }));
    }
    const sh = JSON.stringify(rows.settings);
    if (a.sent.get('settings') !== sh) ck(await a.client.from(T.settings).upsert(rows.settings, { onConflict: 'user_id' }));
    sent.set('settings', sh);
    for (const k of DELETE_ORDER) {
      const stale = [...a.known[k]].filter((id) => !cur[k].has(id));
      for (const part of chunk(stale, 100)) ck(await a.client.from(T[k]).delete().in('id', part));
    }
    a.known = cur; a.sent = sent; a.retries = 0;
    if (!a.dirty) ls.del(DIRTY_KEY);
    ls.set(OWNER_KEY, a.userId);
    setStatus('synced');
  } catch (e) {
    console.warn('[cards] sync failed, will retry:', e);
    a.dirty = true; setStatus('error', e);
    if (a.retries < 6) { const wait = Math.min(60000, 2000 * 2 ** a.retries++); clearTimeout(a.timer); a.timer = setTimeout(() => pushNow(a), wait); }
  } finally {
    a.running = false;
    if (a.dirty && active === a && a.retries === 0) schedule(a);
  }
}
function markSent(a) {
  const rows = toRows(a.store.data, a.userId); a.sent = new Map();
  UPSERT_ORDER.forEach((k) => rows[k].forEach((x) => a.sent.set(k + ':' + x.id, JSON.stringify(x))));
  a.sent.set('settings', JSON.stringify(rows.settings));
}
function schedule(a) { ls.set(DIRTY_KEY, '1'); clearTimeout(a.timer); a.timer = setTimeout(() => pushNow(a), a.delay ?? 1500); }
function backup(suffix, data) { if (hasContent(data)) ls.set(`${LS_KEY}.backup.${suffix}`, JSON.stringify(data)); }

export async function startSync(user, client, store, opts = {}) {
  if (active && active.userId === user.id) return;
  stopSync();
  const a = { userId: user.id, client, store, known: idsOf({}), sent: new Map(), running: false, dirty: false, timer: null, retries: 0, delay: opts.delay, onReplaced: opts.onReplaced };
  active = a;
  try {
    setStatus('syncing');
    const remote = await fetchAll(a);
    if (active !== a) return;
    if (remote === null) { active = null; setStatus('unavailable'); return; }
    a.known = idsOf(remote);
    const owner = ls.get(OWNER_KEY);
    // بيانات المحلي بتاعة مستخدم تاني على نفس المتصفح: ما بنرفعهاش لحساب ده، بنحفظ منها نسخة ونبدأ من حساب المستخدم
    if (owner && owner !== user.id) { backup(owner, store.data); store.data = { decks: [], cards: [], reviews: [], sessions: [], settings: store.data.settings }; store.save(true); ls.del(DIRTY_KEY); }
    ensureUuids(store.data);
    const localHas = hasContent(store.data);
    const pending = ls.get(DIRTY_KEY) === '1' && (!owner || owner === user.id);
    store.onSave = () => schedule(a);
    if (isEmptyRemote(remote)) {
      if (localHas || pending) await pushNow(a); else { ls.set(OWNER_KEY, user.id); setStatus('synced'); }
    } else if (pending) {
      await pushNow(a);                                                       // تعديلات أوفلاين: المحلي يكسب
    } else {
      const rem = fromRemote(remote);
      if (!owner && localHas) {                                               // أول ربط: دمج (union) بدل ما نمسح كروت المستخدم
        const seen = (arr) => new Set(arr.map((x) => x.id));
        const dk = seen(rem.decks), ck_ = seen(rem.cards), rv = seen(rem.reviews), ss = seen(rem.sessions);
        const d = store.data;
        rem.decks.push(...d.decks.filter((x) => !dk.has(x.id))); rem.cards.push(...d.cards.filter((x) => !ck_.has(x.id)));
        rem.reviews.push(...d.reviews.filter((x) => !rv.has(x.id))); rem.sessions.push(...d.sessions.filter((x) => !ss.has(x.id)));
        store.data = { ...rem, settings: rem.settings || d.settings }; store.save(true);
        a.onReplaced?.(); await pushNow(a);
      } else {
        backup(user.id, store.data);
        store.data = { ...rem, settings: rem.settings || store.data.settings }; store.save(true);
        markSent(a);                                                          // اللي اتسحب لسه هو هو: مفيش داعي نرفعه تاني
        ls.set(OWNER_KEY, user.id); a.onReplaced?.(); setStatus('synced', { pulled: true });
      }
    }
  } catch (e) {
    console.warn('[cards] initial sync failed, staying local:', e);
    if (active === a) { active = null; store.onSave = null; setStatus('error', e); setTimeout(() => { if (!active) startSync(user, client, store, opts); }, 20000); }
  }
}
export function stopSync() { if (active) { clearTimeout(active.timer); if (active.store) active.store.onSave = null; } active = null; setStatus('local'); }
export const flush = () => (active ? pushNow(active) : Promise.resolve());

/* ---------- الإقلاع في المتصفح ---------- */
const MSG = {
  local: 'جاري التحقق من حسابك…', syncing: 'جاري المزامنة…', synced: 'تمت المزامنة مع حسابك ✓', anon: 'سجّل الدخول بحسابك على ilogia لمزامنة كروتك بين أجهزتك.',
  unavailable: 'المزامنة غير مفعّلة بعد — كروتك محفوظة على هذا الجهاز.', error: 'تعذرت المزامنة الآن — كروتك محفوظة على هذا الجهاز وهنعيد المحاولة.',
};
async function boot() {
  const store = window.CardsStore; if (!store) return;
  let state = 'local', toasted = false;
  const paint = () => {
    const m = document.getElementById('syncMsg'); if (m) m.textContent = MSG[state] || '';
    const l = document.getElementById('syncLogin'); if (l) l.hidden = state !== 'anon';
  };
  window.CardsSync = { get status() { return state; }, message: () => MSG[state] || '', repaint: paint };
  sync.on((s, info) => {
    state = s; paint();
    if (s === 'synced' && !toasted) { toasted = true; window.toast?.('تمت مزامنة كروتك مع حسابك'); }
    if (s === 'synced' && info?.pulled) { window.applyTheme?.(); window.router?.(); }
  });
  let client, current = null;
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { ...ssoAuth, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  } catch (e) { console.warn('[cards] supabase unavailable, staying local:', e); state = 'unavailable'; paint(); return; }
  const check = async () => {
    try {
      const { data } = await client.auth.getSession(); const u = data?.session?.user || null;
      if (u && (!current || current.id !== u.id)) { current = u; await startSync(u, client, store, { onReplaced: () => { window.applyTheme?.(); window.router?.(); } }); }
      else if (!u && current) { current = null; stopSync(); state = 'anon'; paint(); }
      else if (!u) { state = 'anon'; paint(); }
    } catch (e) { console.warn('[cards] session check failed:', e); }
  };
  await check();
  client.auth.onAuthStateChange(() => { check(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); else check(); });
  addEventListener('online', () => { if (active) { active.retries = 0; schedule(active); } });
}
if (typeof window !== 'undefined' && typeof document !== 'undefined' && window.CardsStore !== undefined) boot();
else if (typeof window !== 'undefined' && typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => boot());
