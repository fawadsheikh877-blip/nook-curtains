// Local preview: serves public/ and runs the same API code with an in-memory store.
// Data disappears when you stop it. Usage:  node scripts/dev-server.mjs   (then open http://localhost:8888)
// Passwords for this preview only:  staff  /  admin
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.__NOOK_MEMORY_STORE__ = true;
process.env.STAFF_PASSWORD ??= 'staff';
process.env.ADMIN_PASSWORD ??= 'admin';
process.env.AUTH_SECRET ??= 'local-preview-secret-local-preview-secret-0123456789';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const api = (await import('../netlify/functions/api.mjs')).default;
const submit = (await import('../netlify/functions/submit.mjs')).default;

// Use the same security headers as netlify.toml
const toml = await readFile(join(root, 'netlify.toml'), 'utf8');
const csp = (toml.match(/Content-Security-Policy\s*=\s*"([^"]+)"/) || [])[1];

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png',
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function runFunction(handler, req, res) {
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
  const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body });
  const response = await handler(request, { ip: req.socket.remoteAddress });
  const headers = {};
  response.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://x').pathname;
    if (path.startsWith('/api/')) return await runFunction(api, req, res);
    if (path === '/api-public/request') return await runFunction(submit, req, res);
    if (path === '/desk') { res.writeHead(301, { Location: '/desk/' }); return res.end(); }
    let file = normalize(path).replace(/^(\.\.[/\\])+/, '');
    if (file.endsWith('/')) file += 'index.html';
    const data = await readFile(join(root, 'public', file));
    const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' };
    if (csp) headers['Content-Security-Policy'] = csp;
    res.writeHead(200, headers);
    res.end(data);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
    res.end(e.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
}).listen(process.env.PORT || 8888, () => {
  console.log(`Preview running at http://localhost:${process.env.PORT || 8888}  (staff desk at /desk/, passwords: staff / admin)`);
});
