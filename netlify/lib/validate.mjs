// Input checks for everything the API accepts. Anything that fails throws an HttpError.

export const INTERESTS = [
  'Curtains', 'Blinds', 'Roman blinds', 'Roller blinds', 'Carpets',
  'Office carpet tiles', 'Wallpaper', 'Vinyl flooring', 'Furniture',
];
export const STAGES = ['enquiry', 'measure', 'quoted', 'confirmed', 'install', 'done', 'lost'];
const UNITS = ['m', 'sqm', 'pc'];
const PROPS = ['Home', 'Office', 'Other'];
const SLOTS = ['', 'Morning', 'Afternoon', 'Evening'];

// Most documents each collection may hold. Each collection is one stored file, so this keeps it small.
export const LIMITS = { jobs: 5000, prices: 500, requests: 300, settings: 5 };

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ID = /^[A-Za-z0-9_-]{1,60}$/;
export function checkId(id) {
  if (!ID.test(id || '')) throw new HttpError(400, 'Invalid id');
}

function isObj(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}
function str(x, max, field) {
  if (x === undefined || x === null) return '';
  if (typeof x !== 'string') throw new HttpError(400, `${field} must be text`);
  if (x.length > max) throw new HttpError(400, `${field} is too long`);
  return x;
}
function clean(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

// Documents the staff desk writes: jobs, prices, settings.
export function checkDoc(col, id, body) {
  if (!isObj(body)) throw new HttpError(400, 'Body must be an object');
  if (JSON.stringify(body).length > 100000) throw new HttpError(413, 'Document too large');
  const doc = { ...body };
  delete doc.id;

  if (col === 'jobs') {
    if (doc.stage !== undefined && !STAGES.includes(doc.stage)) throw new HttpError(400, 'Unknown stage');
    if (doc.lines !== undefined && (!Array.isArray(doc.lines) || doc.lines.length > 200)) {
      throw new HttpError(400, 'Invalid lines');
    }
    if (doc.interest !== undefined && !Array.isArray(doc.interest)) throw new HttpError(400, 'Invalid interest');
    return doc;
  }
  if (col === 'prices') {
    if (!clean(str(doc.name, 120, 'name'))) throw new HttpError(400, 'Item name is required');
    if (!UNITS.includes(doc.unit)) throw new HttpError(400, 'Unknown unit');
    if (typeof doc.rate !== 'number' || !isFinite(doc.rate) || doc.rate < 0 || doc.rate > 1e7) {
      throw new HttpError(400, 'Invalid rate');
    }
    if (doc.min !== undefined && (typeof doc.min !== 'number' || !isFinite(doc.min) || doc.min < 0)) {
      throw new HttpError(400, 'Invalid minimum');
    }
    return doc;
  }
  if (col === 'settings') {
    if (id !== 'invoice') throw new HttpError(400, 'Unknown settings document');
    return { trn: clean(str(doc.trn, 40, 'TRN')), terms: clean(str(doc.terms, 200, 'Terms')), vat: doc.vat !== false };
  }
  throw new HttpError(405, 'This collection cannot be written here');
}

// A request from the public form. Returns null for a bot (honeypot field filled in).
export function checkRequest(body) {
  if (!isObj(body)) throw new HttpError(400, 'Invalid request');
  if (typeof body.website === 'string' && body.website.trim()) return null;

  const name = clean(str(body.name, 80, 'Name'));
  if (!name) throw new HttpError(400, 'Name is required');
  const phone = clean(str(body.phone, 30, 'Phone'));
  if (phone.replace(/\D/g, '').length < 7) throw new HttpError(400, 'A phone number is required');
  const area = clean(str(body.area, 120, 'Area'));
  const prop = PROPS.includes(body.prop) ? body.prop : 'Home';
  const needs = Array.isArray(body.needs) ? [...new Set(body.needs.filter((n) => INTERESTS.includes(n)))] : [];
  if (!needs.length) throw new HttpError(400, 'Choose at least one product');
  const windows = clean(str(body.windows, 3, 'Windows'));
  if (windows && !/^\d{1,3}$/.test(windows)) throw new HttpError(400, 'Windows must be a number');
  const date = str(body.date, 10, 'Date');
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Invalid date');
  const slot = SLOTS.includes(body.slot) ? body.slot : '';
  const notes = clean(str(body.notes, 500, 'Notes')).replace(/\s*\n+\s*/g, ' / ');

  return { name, phone, area, prop, needs, windows, date, slot, notes, createdAt: Date.now() };
}
