// Local dev server: serves /public and /api/* without needing Vercel or Neon.
// - If DATABASE_URL is set, it talks to that Neon database.
// - Otherwise it uses an embedded Postgres (PGlite) stored in ./.pglite
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

if (!process.env.DATABASE_URL) {
  const { PGlite } = await import('@electric-sql/pglite');
  // Return int8 (bigserial ids) as strings, exactly like the Neon driver does, so local runs catch type bugs.
  const db = new PGlite(process.env.PGLITE_DIR || join(root, '.pglite'), { parsers: { 20: (v) => v } });
  await db.exec(readFileSync(join(root, 'db/schema.sql'), 'utf8'));
  await db.exec(readFileSync(join(root, 'db/seed.sql'), 'utf8'));
  globalThis.__SQL_OVERRIDE = async (strings, ...values) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i++) text += `$${i + 1}` + strings[i + 1];
    const r = await db.query(text, values);
    return r.rows;
  };
  console.log('Using embedded Postgres (PGlite). Set DATABASE_URL to use Neon.');
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z0-9_-]/gi, '');
    const file = join(root, 'api', `${name}.js`);
    if (!name || name.startsWith('_') || !existsSync(file)) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"Not found"}'); }
    // Minimal Vercel-style request/response shims
    req.query = Object.fromEntries(url.searchParams);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = undefined; }
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    const mod = await import(pathToFileURL(file).href);
    return mod.default(req, res);
  }
  let p = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
  let f = join(root, 'public', p);
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
