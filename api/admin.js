import { sql, route } from './_lib.js';

// Every method here requires the admin password (x-admin-password header).
export default route(['GET', 'PUT', 'DELETE'], async (req, res) => {
  if (req.method === 'PUT') return update(req, res);
  if (req.method === 'DELETE') return remove(req, res);
  return list(req, res);
}, { admin: true });

// GET /api/admin                              -> { ok: true }   (password check only)
// GET /api/admin?month=YYYY-MM&supplier_id=N  -> that supplier/brand's entries for the month
async function list(req, res) {
  const { month, supplier_id } = req.query || {};
  if (!month && !supplier_id) return res.status(200).json({ ok: true });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return res.status(400).json({ error: 'Invalid month' });
  const sid = Number(supplier_id);
  if (!Number.isInteger(sid)) return res.status(400).json({ error: 'Invalid supplier' });

  const entries = await sql`
    select e.id, to_char(e.entry_date, 'YYYY-MM-DD') as entry_date, e.supplier, e.brand, e.service_id,
           e.service_type, e.qty, e.charge::float8 as charge, e.amount::float8 as amount, e.created_at
    from entries e
    join suppliers s on s.name = e.supplier and s.brand = e.brand
    where s.id = ${sid} and to_char(e.entry_date, 'YYYY-MM') = ${month}
    order by e.entry_date, e.id`;
  const total = Math.round(entries.reduce((a, e) => a + Math.round(e.amount * 100), 0)) / 100;
  res.status(200).json({ entries, total });
}

// PUT { id, entry_date, service_id, qty }
// Keeps the originally stored charge if the service is unchanged; uses the current charge if it changed.
async function update(req, res) {
  const b = req.body || {};
  const id = Number(b.id), serviceId = Number(b.service_id), qty = Number(b.qty);
  const date = String(b.entry_date || '');
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid entry' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return res.status(400).json({ error: 'Invalid date' });
  if (!Number.isInteger(serviceId)) return res.status(400).json({ error: 'Select a service type' });
  if (!Number.isInteger(qty) || qty < 1 || qty > 100000) return res.status(400).json({ error: 'Quantity must be a whole number of 1 or more' });

  const rows = await sql`
    update entries e set
      entry_date   = ${date}::date,
      qty          = ${qty}::int,
      service_id   = v.id,
      service_type = v.name,
      charge       = case when e.service_id = v.id then e.charge else v.charge end,
      amount       = (case when e.service_id = v.id then e.charge else v.charge end) * ${qty}::int
    from services v
    where e.id = ${id} and v.id = ${serviceId}
    returning e.id, to_char(e.entry_date, 'YYYY-MM-DD') as entry_date, e.supplier, e.brand, e.service_id,
              e.service_type, e.qty, e.charge::float8 as charge, e.amount::float8 as amount, e.created_at`;
  if (!rows.length) return res.status(404).json({ error: 'Entry or service not found' });
  res.status(200).json({ entry: rows[0] });
}

// DELETE /api/admin?id=N
async function remove(req, res) {
  const id = Number(req.query?.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid entry' });
  const rows = await sql`delete from entries where id = ${id} returning id`;
  if (!rows.length) return res.status(404).json({ error: 'Entry not found' });
  res.status(200).json({ ok: true, id });
}
