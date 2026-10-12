// Tests for the API using the in-memory store.  Run:  node scripts/api-test.mjs
import assert from 'node:assert/strict';

globalThis.__NOOK_MEMORY_STORE__ = true;
process.env.STAFF_PASSWORD = 'staff-pass';
process.env.ADMIN_PASSWORD = 'admin-pass';
process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret-123456';

const api = (await import('../netlify/functions/api.mjs')).default;
const submit = (await import('../netlify/functions/submit.mjs')).default;

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('ok   ' + name);
  } catch (e) {
    console.error('FAIL ' + name + '\n     ' + (e && e.message));
    process.exitCode = 1;
  }
}

async function call(handler, method, path, { body, cookie, headers = {}, ip = '1.1.1.1', raw } = {}) {
  const h = { ...headers };
  if (method !== 'GET' && !h['content-type']) h['content-type'] = 'application/json';
  if (cookie) h.cookie = cookie;
  const req = new Request('https://nook.test' + path, {
    method, headers: h, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handler(req, { ip });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, data, headers: res.headers };
}
const A = (m, p, o) => call(api, m, p, o);

async function signIn(password, ip) {
  const r = await A('POST', '/api/login', { body: { password }, ip });
  const set = r.headers.get('set-cookie');
  return { r, cookie: set ? set.split(';')[0] : null };
}

const staff = (await signIn('staff-pass', '10.0.0.1')).cookie;
const admin = (await signIn('admin-pass', '10.0.0.2')).cookie;

await test('signed out: session 401, data 401', async () => {
  assert.equal((await A('GET', '/api/session')).status, 401);
  assert.equal((await A('GET', '/api/all')).status, 401);
  assert.equal((await A('PUT', '/api/jobs/j1', { body: { name: 'x' } })).status, 401);
});

await test('login: right passwords give the right role, wrong one fails', async () => {
  assert.equal((await A('GET', '/api/session', { cookie: staff })).data.role, 'staff');
  assert.equal((await A('GET', '/api/session', { cookie: admin })).data.role, 'admin');
  assert.equal((await signIn('nope', '9.9.9.9')).r.status, 401);
});

await test('cookie is HttpOnly, SameSite=Strict and Secure on https', async () => {
  const set = (await A('POST', '/api/login', { body: { password: 'staff-pass' }, ip: '10.0.0.9' })).headers.get('set-cookie');
  assert.match(set, /HttpOnly/); assert.match(set, /SameSite=Strict/); assert.match(set, /Secure/);
});

await test('a forged or tampered cookie is rejected', async () => {
  const bad = staff.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  assert.equal((await A('GET', '/api/session', { cookie: bad })).status, 401);
  assert.equal((await A('GET', '/api/session', { cookie: 'nook_session=abc.def' })).status, 401);
});

await test('wrong passwords lock the address out after 10 tries', async () => {
  for (let i = 0; i < 10; i++) await signIn('guess' + i, '7.7.7.7');
  const r = await signIn('staff-pass', '7.7.7.7');
  assert.equal(r.r.status, 429);
  assert.equal((await signIn('staff-pass', '8.8.8.8')).r.status, 200); // other addresses are unaffected
});

await test('jobs: staff can create, read, update, delete', async () => {
  const job = { name: 'Sara', stage: 'enquiry', interest: ['Curtains'], lines: [], updatedAt: 1 };
  assert.equal((await A('PUT', '/api/jobs/j1', { cookie: staff, body: job })).status, 200);
  let all = (await A('GET', '/api/all', { cookie: staff })).data;
  assert.equal(all.jobs.j1.name, 'Sara');
  await A('PUT', '/api/jobs/j1', { cookie: staff, body: { ...job, stage: 'quoted' } });
  all = (await A('GET', '/api/all', { cookie: staff })).data;
  assert.equal(all.jobs.j1.stage, 'quoted');
  assert.equal((await A('DELETE', '/api/jobs/j1', { cookie: staff })).status, 200);
  all = (await A('GET', '/api/all', { cookie: staff })).data;
  assert.equal(all.jobs.j1, undefined);
});

await test('prices and settings: admin only', async () => {
  const price = { name: 'Blackout curtains', category: 'Curtains', unit: 'm', rate: 240, min: 0 };
  assert.equal((await A('PUT', '/api/prices/p1', { cookie: staff, body: price })).status, 403);
  assert.equal((await A('PUT', '/api/prices/p1', { cookie: admin, body: price })).status, 200);
  assert.equal((await A('PUT', '/api/settings/invoice', { cookie: staff, body: { trn: '1' } })).status, 403);
  assert.equal((await A('PUT', '/api/settings/invoice', { cookie: admin, body: { trn: '100000000000003', terms: 'Due on installation' } })).status, 200);
  assert.equal((await A('DELETE', '/api/prices/p1', { cookie: staff })).status, 403);
  const all = (await A('GET', '/api/all', { cookie: staff })).data;
  assert.equal(all.prices.p1.rate, 240);
  assert.equal(all.settings.invoice.trn, '100000000000003');
  assert.equal(all.settings.invoice.vat, true);
  assert.equal((await A('PUT', '/api/settings/invoice', { cookie: admin, body: { trn: '', vat: false } })).status, 200);
  assert.equal((await A('GET', '/api/all', { cookie: admin })).data.settings.invoice.vat, false);
});

await test('restore: admin only, validated, replaces data', async () => {
  const job = { name: 'Restored Client', stage: 'quoted', lines: [] };
  const price = { name: 'Roller', category: 'Blinds', unit: 'sqm', rate: 90, min: 1 };
  const backup = {
    exportedAt: 'x', jobs: { j1: job }, prices: { p9: price },
    requests: { r1: { name: 'Ali', phone: '0501234567', needs: ['Curtains'], createdAt: 123 } },
    settings: { invoice: { trn: '', terms: 'Net 7', vat: false } },
  };
  assert.equal((await A('POST', '/api/restore', { cookie: staff, body: backup })).status, 403);
  assert.equal((await A('POST', '/api/restore', { body: backup })).status, 401);
  // invalid entries change nothing
  const before = (await A('GET', '/api/all', { cookie: admin })).data;
  assert.equal((await A('POST', '/api/restore', { cookie: admin, body: { jobs: { j1: { stage: 'nonsense' } } } })).status, 400);
  assert.equal((await A('POST', '/api/restore', { cookie: admin, body: { hello: 1 } })).status, 400);
  assert.equal((await A('POST', '/api/restore', { cookie: admin, body: { jobs: { 'bad id': job } } })).status, 400);
  assert.deepEqual((await A('GET', '/api/all', { cookie: admin })).data.jobs, before.jobs);
  const r = await A('POST', '/api/restore', { cookie: admin, body: backup });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.restored, { jobs: 1, prices: 1, requests: 1, settings: 1 });
  const after = (await A('GET', '/api/all', { cookie: admin })).data;
  assert.deepEqual(Object.keys(after.jobs), ['j1']);
  assert.deepEqual(Object.keys(after.prices), ['p9']);
  assert.equal(after.requests.r1.createdAt, 123);
  assert.equal(after.settings.invoice.vat, false);
  // a backup made by /api/export restores cleanly
  const exp = (await A('GET', '/api/export', { cookie: admin })).data;
  assert.equal((await A('POST', '/api/restore', { cookie: admin, body: exp })).status, 200);
});

await test('validation: bad stage, bad price, bad ids, oversize, unknown settings doc', async () => {
  assert.equal((await A('PUT', '/api/jobs/j2', { cookie: staff, body: { stage: 'weird' } })).status, 400);
  assert.equal((await A('PUT', '/api/prices/p2', { cookie: admin, body: { name: 'x', unit: 'kg', rate: 1 } })).status, 400);
  assert.equal((await A('PUT', '/api/prices/p2', { cookie: admin, body: { name: 'x', unit: 'm', rate: -5 } })).status, 400);
  assert.equal((await A('PUT', '/api/jobs/bad%20id', { cookie: staff, body: { name: 'x' } })).status, 400);
  assert.equal((await A('PUT', '/api/jobs/j3', { cookie: staff, body: { notes: 'x'.repeat(130000) } })).status, 413);
  assert.equal((await A('PUT', '/api/settings/other', { cookie: admin, body: { trn: '1' } })).status, 400);
  assert.equal((await A('PUT', '/api/requests/r1', { cookie: admin, body: { name: 'x' } })).status, 405);
});

await test('writes must be JSON (blocks forged form posts)', async () => {
  const r = await A('PUT', '/api/jobs/j4', { cookie: staff, raw: 'name=x', headers: { 'content-type': 'text/plain' } });
  assert.equal(r.status, 415);
});

await test('two people saving different jobs at once both succeed', async () => {
  const saves = [];
  for (let i = 0; i < 12; i++) saves.push(A('PUT', '/api/jobs/c' + i, { cookie: staff, body: { name: 'Job ' + i, stage: 'enquiry' } }));
  const results = await Promise.all(saves);
  assert.ok(results.every((r) => r.status === 200), results.map((r) => r.status).join(','));
  const all = (await A('GET', '/api/all', { cookie: staff })).data;
  for (let i = 0; i < 12; i++) assert.equal(all.jobs['c' + i].name, 'Job ' + i);
});

await test('polling: same ETag answers 304, a change gives a new ETag', async () => {
  const first = await A('GET', '/api/all', { cookie: staff });
  const tag = first.headers.get('etag');
  assert.ok(tag);
  const same = await A('GET', '/api/all', { cookie: staff, headers: { 'if-none-match': tag } });
  assert.equal(same.status, 304);
  await A('PUT', '/api/jobs/etag1', { cookie: staff, body: { name: 'New' } });
  const changed = await A('GET', '/api/all', { cookie: staff, headers: { 'if-none-match': tag } });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get('etag'), tag);
});

const goodRequest = { name: 'Sara Khan', phone: '050 123 4567', area: 'Dubai Marina', prop: 'Home', needs: ['Curtains', 'Roman blinds'], windows: '5', date: '2026-10-14', slot: 'Morning', notes: 'Likes grey\nbudget flexible', website: '' };

await test('public request: valid one lands in the staff inbox and nowhere else', async () => {
  const r = await call(submit, 'POST', '/api-public/request', { body: goodRequest });
  assert.equal(r.status, 201);
  const all = (await A('GET', '/api/all', { cookie: staff })).data;
  const mine = Object.values(all.requests).find((x) => x.name === 'Sara Khan');
  assert.ok(mine); assert.equal(mine.notes, 'Likes grey / budget flexible'); assert.deepEqual(mine.needs, ['Curtains', 'Roman blinds']);
  assert.equal((await A('GET', '/api/all')).status, 401); // still private
});

await test('public request: rejects missing name, short phone, no product, junk fields', async () => {
  const bad = async (patch) => (await call(submit, 'POST', '/api-public/request', { body: { ...goodRequest, ...patch } })).status;
  assert.equal(await bad({ name: '' }), 400);
  assert.equal(await bad({ phone: '12' }), 400);
  assert.equal(await bad({ needs: [] }), 400);
  assert.equal(await bad({ needs: ['Pizza'] }), 400);
  assert.equal(await bad({ windows: 'many' }), 400);
  assert.equal(await bad({ date: 'tomorrow' }), 400);
  assert.equal(await bad({ notes: 'x'.repeat(501) }), 400);
});

await test('public request: honeypot is accepted silently and not stored', async () => {
  const before = Object.keys((await A('GET', '/api/all', { cookie: staff })).data.requests).length;
  const r = await call(submit, 'POST', '/api-public/request', { body: { ...goodRequest, website: 'http://spam.example' } });
  assert.equal(r.status, 201);
  const after = Object.keys((await A('GET', '/api/all', { cookie: staff })).data.requests).length;
  assert.equal(after, before);
});

await test('public request: JSON only, size capped, GET refused', async () => {
  assert.equal((await call(submit, 'POST', '/api-public/request', { raw: 'x', headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await call(submit, 'POST', '/api-public/request', { raw: JSON.stringify({ ...goodRequest, pad: 'x'.repeat(9000) }) })).status, 413);
  assert.equal((await call(submit, 'GET', '/api-public/request')).status, 405);
});

await test('requests: staff can dismiss, customers cannot', async () => {
  const all = (await A('GET', '/api/all', { cookie: staff })).data;
  const id = Object.keys(all.requests)[0];
  assert.equal((await A('DELETE', '/api/requests/' + id)).status, 401);
  assert.equal((await A('DELETE', '/api/requests/' + id, { cookie: staff })).status, 200);
});

await test('backup: admin only, contains every collection', async () => {
  assert.equal((await A('GET', '/api/export', { cookie: staff })).status, 403);
  const r = await A('GET', '/api/export', { cookie: admin });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /nook-backup-\d{4}-\d{2}-\d{2}\.json/);
  for (const c of ['jobs', 'prices', 'requests', 'settings']) assert.ok(r.data[c]);
});

await test('health: reports setup, deep check needs a session and passes', async () => {
  const h = await A('GET', '/api/health');
  assert.equal(h.status, 200); assert.equal(h.data.storage, 'ok'); assert.equal(h.data.configured.AUTH_SECRET_32_CHARS, true);
  assert.equal((await A('GET', '/api/health?deep=1')).status, 401);
  const d = await A('GET', '/api/health?deep=1', { cookie: staff });
  assert.equal(d.status, 200, JSON.stringify(d.data)); assert.ok(d.data.deep.every((s) => s.ok));
});

await test('not configured: login and session say so instead of failing quietly', async () => {
  const saved = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'short';
  assert.equal((await A('GET', '/api/session')).status, 503);
  assert.equal((await A('POST', '/api/login', { body: { password: 'staff-pass' } })).status, 503);
  assert.equal((await A('GET', '/api/health')).status, 503);
  process.env.AUTH_SECRET = saved;
});

console.log(`\n${passed} passed${process.exitCode ? ', with failures' : ''}`);
