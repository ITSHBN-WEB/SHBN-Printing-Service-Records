import { sql, route } from './_lib.js';

// One row per supplier + brand that has records in the month, with its services stacked.
export default route(['GET'], async (req, res) => {
  const month = String(req.query?.month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });

  const rows = await sql`
    with s as (
      select supplier, brand, service_type, sum(qty)::int as qty, sum(amount) as amount
      from entries
      where to_char(entry_date, 'YYYY-MM') = ${month}
      group by supplier, brand, service_type
    )
    select supplier, brand,
           round(sum(amount), 2)::float8 as total,
           json_agg(json_build_object('service_type', service_type, 'qty', qty, 'amount', amount::float8)
                    order by service_type) as services
    from s
    group by supplier, brand
    order by supplier, brand`;

  const grand = Math.round(rows.reduce((a, r) => a + Math.round(r.total * 100), 0)) / 100;
  res.status(200).json({ month, rows, grand_total: grand });
});
