import { sql, route } from './_lib.js';

// Suppliers (with brand) and service charges for the New Entry form.
export default route(['GET'], async (req, res) => {
  const [suppliers, services] = await Promise.all([
    sql`select id, name, brand from suppliers order by brand, name`,
    sql`select id, name, charge::float8 as charge from services order by sort_order, name`,
  ]);
  res.status(200).json({ suppliers, services });
});
