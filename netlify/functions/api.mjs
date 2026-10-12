// Staff API. One function, routed by path under /api/.
//
//   GET    /api/health            public: is the site set up? (?deep=1 with a staff session tests storage)
//   GET    /api/session           who am I? 401 when signed out
//   POST   /api/login             { password } -> sets the session cookie
//   POST   /api/logout
//   GET    /api/all               staff: every collection in one response (supports If-None-Match -> 304)
//   PUT    /api/:collection/:id   staff (admin for prices and settings): save one document
//   DELETE /api/:collection/:id   staff (admin for prices and settings): delete one document
//   GET    /api/export            admin: everything as a downloadable backup
//   POST   /api/restore           admin: replace the data with the contents of a backup file
import { createHash } from 'node:crypto';
import { clearCookie, clientKey, cookieHeader, env, makeToken, readSession, roleFor } from '../lib/auth.mjs';
import {
  COLLECTIONS, addFail, clearFails, etagOf, failCount, mutate, readCollection, selfTest,
} from '../lib/store.mjs';
import { HttpError, LIMITS, checkDoc, checkId, checkRequest } from '../lib/validate.mjs';

export const config = {
  path: '/api/*',
  rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};

const RULES = {
  jobs: { write: 'staff', del: 'staff' },
  prices: { write: 'admin', del: 'admin' },
  settings: { write: 'admin', del: 'admin' },
  requests: { write: null, del: 'staff' }, // customers write requests through /api-public/request
};
const RANK = { staff: 1, admin: 2 };
const MAX_LOGIN_FAILS = 10;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function need(session, role) {
  if (!session) throw new HttpError(401, 'Sign in required');
  if (RANK[session.role] < RANK[role]) throw new HttpError(403, 'Only the admin password can do this');
}

async function readJson(req, max) {
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, 'Request too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

const hash = (s) => `"${createHash('sha1').update(s).digest('hex')}"`;

async function login(req, context) {
  const cfg = env();
  if (!cfg.ok) throw new HttpError(503, 'not_configured');
  const key = clientKey(req, context);
  if ((await failCount(key)) >= MAX_LOGIN_FAILS) {
    throw new HttpError(429, 'Too many wrong passwords. Wait 15 minutes and try again.');
  }
  const body = await readJson(req, 2000);
  const role = roleFor(body && body.password);
  if (!role) {
    await addFail(key);
    throw new HttpError(401, 'Wrong password');
  }
  await clearFails(key).catch(() => {});
  return json({ role }, 200, { 'Set-Cookie': cookieHeader(makeToken(role), req) });
}

async function all(req) {
  const names = COLLECTIONS;
  const inm = req.headers.get('if-none-match');
  if (inm) {
    const tags = await Promise.all(names.map(etagOf));
    const current = hash(tags.join('|'));
    if (inm === current) return new Response(null, { status: 304, headers: { ETag: current, 'Cache-Control': 'no-store' } });
  }
  const reads = await Promise.all(names.map(readCollection));
  const body = {};
  names.forEach((n, i) => { body[n] = reads[i].map; });
  return json(body, 200, { ETag: hash(reads.map((r) => r.etag).join('|')) });
}

async function exportAll() {
  const reads = await Promise.all(COLLECTIONS.map(readCollection));
  const data = { exportedAt: new Date().toISOString() };
  COLLECTIONS.forEach((n, i) => { data[n] = reads[i].map; });
  const day = new Date().toISOString().slice(0, 10);
  return json(data, 200, { 'Content-Disposition': `attachment; filename="nook-backup-${day}.json"` });
}

// Replace the data with the contents of a backup file made by "Download backup".
// Everything is checked first; nothing is changed unless the whole file is valid.
// Only the collections present in the file are replaced.
async function restore(req) {
  const body = await readJson(req, 5 * 1024 * 1024);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'This is not a Nook Curtains backup file');
  const next = {};
  for (const col of ['jobs', 'prices', 'requests', 'settings']) {
    if (body[col] === undefined) continue;
    const src = body[col];
    if (!src || typeof src !== 'object' || Array.isArray(src)) throw new HttpError(400, `The backup's ${col} section is not valid`);
    const ids = Object.keys(src);
    if (ids.length > LIMITS[col]) throw new HttpError(400, `The backup has too many ${col} (limit ${LIMITS[col]})`);
    const out = {};
    for (const id of ids) {
      try {
        checkId(id);
        if (col === 'requests') {
          const doc = checkRequest(src[id]);
          if (!doc) throw new HttpError(400, 'Invalid request');
          out[id] = typeof src[id].createdAt === 'number' ? { ...doc, createdAt: src[id].createdAt } : doc;
        } else {
          out[id] = checkDoc(col, id, src[id]);
        }
      } catch (e) {
        if (e instanceof HttpError) throw new HttpError(400, `Backup entry ${col}/${id}: ${e.message}`);
        throw e;
      }
    }
    next[col] = out;
  }
  if (!Object.keys(next).length) throw new HttpError(400, 'This is not a Nook Curtains backup file');
  const counts = {};
  for (const [col, out] of Object.entries(next)) {
    await mutate(col, (m) => {
      for (const k of Object.keys(m)) delete m[k];
      Object.assign(m, out);
    });
    counts[col] = Object.keys(out).length;
  }
  return json({ ok: true, restored: counts });
}

async function health(req, url) {
  const cfg = env();
  const out = {
    configured: {
      STAFF_PASSWORD: !!cfg.staff,
      ADMIN_PASSWORD: !!cfg.admin,
      AUTH_SECRET_32_CHARS: cfg.secret.length >= 32,
      passwordsDifferent: !!cfg.staff && cfg.staff !== cfg.admin,
    },
    storage: 'ok',
  };
  try {
    await etagOf('jobs');
  } catch {
    out.storage = 'error';
  }
  if (url.searchParams.get('deep') === '1') {
    need(readSession(req), 'staff');
    out.deep = await selfTest();
  }
  out.ok = cfg.ok && out.storage === 'ok' && (!out.deep || out.deep.every((s) => s.ok));
  return json(out, out.ok ? 200 : 503);
}

async function handle(req, context) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const method = req.method;

  // Writes must be JSON. Browsers cannot send that cross-site without a permission check, which blocks forged requests.
  if (method !== 'GET' && !(req.headers.get('content-type') || '').includes('application/json')) {
    throw new HttpError(415, 'JSON only');
  }

  if (parts[0] === 'health' && method === 'GET') return health(req, url);
  if (parts[0] === 'login' && method === 'POST') return login(req, context);
  if (parts[0] === 'logout' && method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(req) });
  if (parts[0] === 'session' && method === 'GET') {
    if (!env().ok) throw new HttpError(503, 'not_configured');
    const s = readSession(req);
    if (!s) throw new HttpError(401, 'Sign in required');
    return json({ role: s.role });
  }

  const session = readSession(req);
  if (parts[0] === 'all' && method === 'GET') {
    need(session, 'staff');
    return all(req);
  }
  if (parts[0] === 'export' && method === 'GET') {
    need(session, 'admin');
    return exportAll();
  }
  if (parts[0] === 'restore' && method === 'POST') {
    need(session, 'admin');
    return restore(req);
  }

  const rule = RULES[parts[0]];
  if (rule && parts.length === 2) {
    const [col, id] = parts;
    if (method === 'PUT') {
      if (!rule.write) throw new HttpError(405, 'Not allowed');
      need(session, rule.write);
      checkId(id);
      const doc = checkDoc(col, id, await readJson(req, 120000));
      await mutate(col, (m) => {
        if (!(id in m) && Object.keys(m).length >= LIMITS[col]) {
          throw new HttpError(507, 'Storage limit reached. Delete old items first.');
        }
        m[id] = doc;
      });
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      need(session, rule.del);
      checkId(id);
      await mutate(col, (m) => { delete m[id]; });
      return json({ ok: true });
    }
  }
  throw new HttpError(404, 'Not found');
}

export default async (req, context) => {
  try {
    return await handle(req, context);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('api error', e);
    return json({ error: e && e.status === 409 ? e.message : 'Server error' }, (e && e.status) || 500);
  }
};
