import { sql, route } from './_lib.js';

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// One row per supplier + brand with records between ?from=YYYY-MM-DD and ?to=YYYY-MM-DD (inclusive),
// with its services stacked. A service charged at two different prices in the range gets one line per price.
export default route(['GET'], async (req, res) => {
  const from = String(req.query?.from || '');
  const to = String(req.query?.to || '');
  if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: 'from and to must be dates (YYYY-MM-DD)' });
  if (from > to) return res.status(400).json({ error: 'The end date must be on or after the start date' });

  const rows = await sql`
    with s as (
      select supplier, brand, service_type, charge, sum(qty)::int as qty, sum(amount) as amount
      from entries
      where entry_date between ${from}::date and ${to}::date
      group by supplier, brand, service_type, charge
    )
    select supplier, brand,
           round(sum(amount), 2)::float8 as total,
           json_agg(json_build_object('service_type', service_type, 'charge', charge::float8, 'qty', qty, 'amount', amount::float8)
                    order by service_type, charge) as services
    from s
    group by supplier, brand
    order by supplier, brand`;

  const grand = Math.round(rows.reduce((a, r) => a + Math.round(r.total * 100), 0)) / 100;
  res.status(200).json({ from, to, rows, grand_total: grand });
});
