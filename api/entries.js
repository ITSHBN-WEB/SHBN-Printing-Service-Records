import { sql, route } from './_lib.js';

export default route(['GET', 'POST'], async (req, res) => {
  if (req.method === 'POST') return create(req, res);
  return list(req, res);
});

async function list(req, res) {
  const q = req.query || {};
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 200, 1), 500);
  const month = /^\d{4}-\d{2}$/.test(q.month || '') ? q.month : null;
  const term = q.q && String(q.q).trim() ? `%${String(q.q).trim().replace(/[%_\\]/g, '\\$&')}%` : null;

  const [entries, sum] = await Promise.all([
    sql`select id, to_char(entry_date, 'YYYY-MM-DD') as entry_date, supplier, brand,
               service_type, qty, charge::float8 as charge, amount::float8 as amount, created_at
        from entries
        where (${month}::text is null or to_char(entry_date, 'YYYY-MM') = ${month})
          and (${term}::text is null or supplier ilike ${term} or brand ilike ${term} or service_type ilike ${term})
        order by entry_date desc, id desc
        limit ${limit}`,
    sql`select count(*)::int as count, coalesce(sum(amount), 0)::float8 as total
        from entries
        where (${month}::text is null or to_char(entry_date, 'YYYY-MM') = ${month})
          and (${term}::text is null or supplier ilike ${term} or brand ilike ${term} or service_type ilike ${term})`,
  ]);
  res.status(200).json({ entries, count: sum[0].count, total: sum[0].total });
}

async function create(req, res) {
  const b = req.body || {};
  const date = String(b.entry_date || '');
  const supplierId = Number(b.supplier_id);
  const serviceId = Number(b.service_id);
  const qty = Number(b.qty);

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));
  if (!validDate) return res.status(400).json({ error: 'Invalid date' });
  if (!Number.isInteger(supplierId)) return res.status(400).json({ error: 'Select a supplier / brand' });
  if (!Number.isInteger(serviceId)) return res.status(400).json({ error: 'Select a service type' });
  if (!Number.isInteger(qty) || qty < 1 || qty > 100000) return res.status(400).json({ error: 'Quantity must be a whole number of 1 or more' });

  // Supplier, brand and charge are looked up server-side; the amount is always
  // computed here, never trusted from the browser.
  const rows = await sql`
    insert into entries (entry_date, supplier_id, supplier, brand, service_id, service_type, qty, charge, amount)
    select ${date}::date, s.id, s.name, s.brand, v.id, v.name, ${qty}::int, v.charge, v.charge * ${qty}::int
    from suppliers s, services v
    where s.id = ${supplierId} and v.id = ${serviceId}
    returning id, to_char(entry_date, 'YYYY-MM-DD') as entry_date, supplier, brand,
              service_type, qty, charge::float8 as charge, amount::float8 as amount, created_at`;
  if (!rows.length) return res.status(400).json({ error: 'Unknown supplier or service' });
  res.status(201).json({ entry: rows[0] });
}
