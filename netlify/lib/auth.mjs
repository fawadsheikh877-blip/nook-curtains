// Shared-password sign-in for staff. Two passwords, set as Netlify environment variables:
//   STAFF_PASSWORD  can use the desk (jobs, quotes, invoices, customer requests)
//   ADMIN_PASSWORD  can also change prices, invoice details and download a backup
//   AUTH_SECRET     long random text used to sign the session cookie (32+ characters)
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'nook_session';
const MAX_AGE = 7 * 24 * 3600; // seconds

export function env() {
  const staff = process.env.STAFF_PASSWORD || '';
  const admin = process.env.ADMIN_PASSWORD || '';
  const secret = process.env.AUTH_SECRET || '';
  return {
    staff,
    admin,
    secret,
    ok: !!staff && !!admin && staff !== admin && secret.length >= 32,
  };
}

const digest = (s) => createHash('sha256').update(String(s)).digest();
const same = (a, b) => timingSafeEqual(digest(a), digest(b));

export function roleFor(password) {
  const c = env();
  if (!c.ok || typeof password !== 'string' || !password) return null;
  const isAdmin = same(password, c.admin);
  const isStaff = same(password, c.staff);
  return isAdmin ? 'admin' : isStaff ? 'staff' : null;
}

const sign = (payload, secret) => createHmac('sha256', secret).update(payload).digest('base64url');

export function makeToken(role) {
  const { secret } = env();
  const payload = Buffer.from(JSON.stringify({ r: role, e: Date.now() + MAX_AGE * 1000 })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function readSession(req) {
  const c = env();
  if (!c.ok) return null;
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload, c.secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
  if (!data || typeof data.e !== 'number' || data.e < Date.now() || !['staff', 'admin'].includes(data.r)) return null;
  return { role: data.r };
}

const secureFlag = (req) => (new URL(req.url).protocol === 'https:' ? '; Secure' : '');

export function cookieHeader(token, req) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE}${secureFlag(req)}`;
}
export function clearCookie(req) {
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureFlag(req)}`;
}

export function clientKey(req, context) {
  const ip = (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || 'unknown';
  return createHash('sha256').update(String(ip)).digest('hex').slice(0, 16);
}
