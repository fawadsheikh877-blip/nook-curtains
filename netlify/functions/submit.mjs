// Public endpoint behind the customer form: POST /api-public/request
// It only ever adds a request to the staff inbox. It cannot read or change anything else.
import { mutate } from '../lib/store.mjs';
import { HttpError, LIMITS, checkRequest } from '../lib/validate.mjs';
import { randomUUID } from 'node:crypto';

export const config = {
  path: '/api-public/request',
  method: ['POST'],
  rateLimit: { windowLimit: 6, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default async (req) => {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    if (!(req.headers.get('content-type') || '').includes('application/json')) throw new HttpError(415, 'JSON only');
    const text = await req.text();
    if (text.length > 8000) throw new HttpError(413, 'Request too large');
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'Invalid JSON');
    }
    const doc = checkRequest(body);
    if (doc === null) return json({ ok: true }, 201); // bot: pretend it worked, store nothing
    const id = randomUUID().replace(/-/g, '').slice(0, 20);
    await mutate('requests', (m) => {
      if (Object.keys(m).length >= LIMITS.requests) throw new HttpError(503, 'The inbox is full. Please call us instead.');
      m[id] = doc;
    });
    return json({ ok: true }, 201);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('submit error', e);
    return json({ error: 'Server error' }, 500);
  }
};
