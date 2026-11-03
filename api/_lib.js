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

// Wraps a handler with method check, auth check and error handling.
export function route(methods, fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!methods.includes(req.method)) {
      res.setHeader('Allow', methods.join(', '));
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!authorized(req)) return res.status(401).json({ error: 'Access code required' });
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  };
}
