// Storage layer. In production this is Netlify Blobs (built into Netlify, nothing to sign up for).
// Tests and the local dev server set globalThis.__NOOK_MEMORY_STORE__ to use an in-memory copy instead.
//
// Each collection (jobs, prices, requests, settings) is stored as ONE blob named "all" holding
// { id: document }. Changes are read, modified and written back with a compare-and-swap on the
// blob's etag, retried if two people save at the same moment, so one save never wipes out another.

export const COLLECTIONS = ['jobs', 'prices', 'requests', 'settings'];

const tables = new Map();
function memFor(name) {
  if (!tables.has(name)) tables.set(name, { rows: new Map(), n: 0 });
  const t = tables.get(name);
  const tick = () => new Promise((r) => setImmediate(r)); // lets concurrent calls interleave, like a network would
  return {
    async getMetadata(k) {
      await tick();
      const r = t.rows.get(k);
      return r ? { etag: r.etag, metadata: {} } : null;
    },
    async getWithMetadata(k) {
      await tick();
      const r = t.rows.get(k);
      return r ? { data: JSON.parse(r.json), etag: r.etag, metadata: {} } : null;
    },
    async setJSON(k, v, o = {}) {
      await tick();
      const cur = t.rows.get(k);
      if (o.onlyIfNew && cur) return { modified: false };
      if (o.onlyIfMatch && (!cur || cur.etag !== o.onlyIfMatch)) return { modified: false };
      t.n += 1;
      const etag = `"${t.n}"`;
      t.rows.set(k, { json: JSON.stringify(v), etag });
      return { modified: true, etag };
    },
    async delete(k) {
      await tick();
      t.rows.delete(k);
    },
  };
}

async function open(name) {
  if (globalThis.__NOOK_MEMORY_STORE__) return memFor(name);
  const { getStore } = await import('@netlify/blobs');
  return getStore({ name: `nook-${name}`, consistency: 'strong' });
}

const KEY = 'all';

export async function etagOf(name) {
  const s = await open(name);
  const m = await s.getMetadata(KEY);
  return m ? m.etag : '-';
}

export async function readCollection(name) {
  const s = await open(name);
  const cur = await s.getWithMetadata(KEY, { type: 'json' });
  return cur ? { map: cur.data || {}, etag: cur.etag } : { map: {}, etag: '-' };
}

// Apply fn(map) to a collection safely. fn mutates the map and may throw to abort.
export async function mutate(name, fn) {
  const s = await open(name);
  for (let attempt = 0; attempt < 8; attempt++) {
    const cur = await s.getWithMetadata(KEY, { type: 'json' });
    const map = cur && cur.data ? cur.data : {};
    const result = fn(map);
    const res = cur
      ? await s.setJSON(KEY, map, { onlyIfMatch: cur.etag })
      : await s.setJSON(KEY, map, { onlyIfNew: true });
    if (res && res.modified) return result;
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 60));
  }
  const err = new Error('Could not save because others were saving at the same time. Try again.');
  err.status = 409;
  throw err;
}

// Sign-in attempt counters, so the shared passwords cannot be guessed by trial and error.
const FAIL_WINDOW_MS = 15 * 60 * 1000;
export async function failCount(key) {
  const { map } = await readCollection('auth');
  const e = map[key];
  return !e || Date.now() - e.t > FAIL_WINDOW_MS ? 0 : e.c;
}
export async function addFail(key) {
  await mutate('auth', (m) => {
    const now = Date.now();
    const e = m[key];
    m[key] = !e || now - e.t > FAIL_WINDOW_MS ? { c: 1, t: now } : { c: e.c + 1, t: e.t };
    for (const k of Object.keys(m)) if (now - m[k].t > FAIL_WINDOW_MS) delete m[k];
  });
}
export async function clearFails(key) {
  await mutate('auth', (m) => {
    delete m[key];
  });
}

// Exercises every storage call the app relies on. Used by /api/health?deep=1 after the first deploy.
export async function selfTest() {
  const steps = [];
  const step = async (name, fn) => {
    try {
      const d = await fn();
      steps.push({ name, ok: d !== false, detail: typeof d === 'boolean' ? undefined : d });
    } catch (e) {
      steps.push({ name, ok: false, detail: String((e && e.message) || e) });
    }
  };
  const s = await open('health');
  let etag;
  await step('write', async () => {
    const r = await s.setJSON('ping', { t: Date.now() });
    etag = r && r.etag;
    return !!(r && r.modified);
  });
  await step('read etag', async () => {
    const m = await s.getMetadata('ping');
    return !!(m && m.etag) && (etag ? m.etag === etag : true);
  });
  await step('read data', async () => {
    const m = await s.getWithMetadata('ping', { type: 'json' });
    return !!(m && m.data && m.data.t);
  });
  await step('reject stale write', async () => {
    const r = await s.setJSON('ping', { t: 0 }, { onlyIfMatch: '"stale"' });
    return !!r && r.modified === false;
  });
  await step('accept matching write', async () => {
    const m = await s.getMetadata('ping');
    const r = await s.setJSON('ping', { t: Date.now() }, { onlyIfMatch: m.etag });
    return !!(r && r.modified);
  });
  await step('delete', async () => {
    await s.delete('ping');
    return (await s.getMetadata('ping')) === null;
  });
  return steps;
}
