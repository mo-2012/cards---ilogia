// ilogia — دخول موحد بين *.ilogia-eg.com عن طريق جلسة Supabase مخزّنة في كوكي على الدومين الأب.
// نفس المفتاح ونفس صيغة الكوكي المستخدمة في app.ilogia-eg.com (ilogia-eco-auth + تقسيم لأجزاء)، فكل المواقع بتشارك جلسة واحدة.
// خارج الدومين (localhost / معاينات) بيستخدم localStorage عادي.
// ملاحظة أمان: الكوكي مقروءة من JavaScript على كل subdomain تحت ilogia-eg.com، فأي موقع فيهم يحمّل سكربت خارجي مش موثوق = خطر على الجلسة.
export const SSO_KEY = 'ilogia-eco-auth';
const DOMAIN = '.ilogia-eg.com';
// مفاتيح localStorage القديمة: بتتنقل مرة واحدة للكوكي (وبتتمسح) عشان محدش يتسجل خروجه
const LEGACY_KEYS = ['sb-zugwicbbfbefbbwugfxq-auth-token', 'ilogia-library-auth'];
const CHUNK = 3000, AGE = 30 * 86400;

const onEco = () => { try { const h = location.hostname; return h === 'ilogia-eg.com' || h.endsWith(DOMAIN); } catch { return false; } };

function cookieStore() {
  const read = (n) => { const m = document.cookie.split('; ').find((c) => c.startsWith(n + '=')); return m ? decodeURIComponent(m.slice(n.length + 1)) : null; };
  const write = (n, v, age) => { document.cookie = `${n}=${encodeURIComponent(v)}; Domain=${DOMAIN}; Path=/; Max-Age=${age}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; };
  const count = (k) => Number(read(`${k}.n`) || 0);
  const set = (k, v) => {
    const old = count(k), parts = Math.max(1, Math.ceil(v.length / CHUNK));
    for (let i = 0; i < parts; i++) write(`${k}.${i}`, v.slice(i * CHUNK, (i + 1) * CHUNK), AGE);
    for (let i = parts; i < old; i++) write(`${k}.${i}`, '', 0);
    write(`${k}.n`, String(parts), AGE);
  };
  const get = (k) => { const n = count(k); if (!n) return null; let o = ''; for (let i = 0; i < n; i++) { const p = read(`${k}.${i}`); if (p === null) return null; o += p; } return o; };
  return {
    getItem(k) {
      const v = get(k); if (v !== null || k !== SSO_KEY) return v;
      for (const lk of LEGACY_KEYS) { try { const old = localStorage.getItem(lk); if (old) { set(k, old); localStorage.removeItem(lk); return old; } } catch { /* ignore */ } }
      return null;
    },
    setItem: set,
    removeItem(k) { const n = count(k); for (let i = 0; i < n; i++) write(`${k}.${i}`, '', 0); write(`${k}.n`, '', 0); },
  };
}
function localStore() {
  const mem = new Map();
  try { const t = '__ilg_probe__'; localStorage.setItem(t, '1'); localStorage.removeItem(t); return localStorage; }
  catch { return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) }; }
}
// استخدمها هكذا: createClient(url, key, { auth: { ...ssoAuth, persistSession: true, ... } })
export const ssoAuth = { storageKey: SSO_KEY, storage: onEco() ? cookieStore() : localStore() };
