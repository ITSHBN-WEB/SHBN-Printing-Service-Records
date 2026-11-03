import { sql, route } from './_lib.js';

// Today / this-month totals for the dashboard (Malaysia time).
export default route(['GET'], async (req, res) => {
  const r = await sql`
    with t as (select (now() at time zone 'Asia/Kuala_Lumpur')::date as d)
    select
      count(*) filter (where e.entry_date = t.d)::int as today_count,
      coalesce(sum(e.amount) filter (where e.entry_date = t.d), 0)::float8 as today_total,
      count(*) filter (where date_trunc('month', e.entry_date) = date_trunc('month', t.d))::int as month_count,
      coalesce(sum(e.amount) filter (where date_trunc('month', e.entry_date) = date_trunc('month', t.d)), 0)::float8 as month_total
    from t left join entries e on true
    group by t.d`;
  const x = r[0];
  res.status(200).json({
    today: { count: x.today_count, total: x.today_total },
    month: { count: x.month_count, total: x.month_total },
  });
});
