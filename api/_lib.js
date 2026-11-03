import { timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

let client;

// Tagged-template query helper. `globalThis.__SQL_OVERRIDE` is a seam used only
// by dev/server.mjs so the app can run locally against an embedded Postgres.
export function sql(strings, ...values) {
  if (globalThis.__SQL_OVERRIDE) return globalThis.__SQL_OVERRIDE(strings, ...values);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  client ??= neon(process.env.DATABASE_URL);
  return client(strings, ...values);
}

// Optional shared access code. If ACCESS_CODE is unset the API is open.
export function authorized(req) {
  const code = process.env.ACCESS_CODE;
  if (!code) return true;
  return req.headers['x-access-code'] === code;
}

function same(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Admin password for edit / delete. Set ADMIN_PASSWORD in Vercel to change it
// without touching code; falls back to 8888.
export function adminOk(req) {
  return same(req.headers['x-admin-password'], process.env.ADMIN_PASSWORD || '8888');
}

// Wraps a handler with method check, auth check and error handling.
// { admin: true } additionally requires the admin password.
export function route(methods, fn, { admin = false } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!methods.includes(req.method)) {
      res.setHeader('Allow', methods.join(', '));
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!authorized(req)) return res.status(401).json({ error: 'Access code required' });
    if (admin && !adminOk(req)) {
      // small delay slows down password guessing
      await new Promise((r) => setTimeout(r, 700));
      return res.status(401).json({ error: 'Incorrect admin password', admin: true });
    }
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  };
}
