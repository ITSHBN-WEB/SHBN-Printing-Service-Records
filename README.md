# SHBN - Printing Service Records

Records photocopy / print / laminate services charged to suppliers.
Stack: static frontend (`public/`) + Vercel serverless API (`api/`) + Neon Postgres.

## What's in v1
- **Dashboard**: greeting, today / this-month totals, **New Entry** form, **Recent Activity**
- **New Entry**: date → type a few letters of a brand or supplier ("kong" → KONG BROTHERS), pick with tap or Enter → choose service (charge shown) → quantity → live total (charge × qty) → submit. Supplier and brand are both saved.
- **Submitted Entries**: every saved entry, filter by month, search, running total
- **Monthly Summary**: printable A4 report for any month (suppliers/brands with records only, services stacked, grand total, Prepared by / Verified by). Print opens the browser print dialog on the same page; text auto-shrinks so it always fits one sheet

The amount is always recalculated on the server from the stored charge, and each entry keeps a snapshot of supplier, brand, service and charge, so later changes to the lists never alter past records.

- **Admin** (password protected): pick a month, then a brand (same picker as New Entry) to see that brand's entries and **edit** date / service / quantity, **save**, or **delete** (two-step confirm). The password is checked on the server for every edit and delete, and the tab locks again whenever you leave it. Default password is `8888`; set the `ADMIN_PASSWORD` env var in Vercel to change it without editing code.
  - Editing keeps an entry's original charge unless you change its service type, in which case the current charge for the new service is used.

## Deploy (about 10 minutes)

### 1. Neon (database)
1. neon.tech → **New project** → copy the **connection string** (Connect → pooled).
2. Create tables and load your 49 suppliers + 9 services, either:
   - Neon **SQL Editor**: paste `db/schema.sql`, Run; then paste `db/seed.sql`, Run, **or**
   - Terminal: `npm install` then `DATABASE_URL="postgresql://..." npm run db:setup`

### 2. GitHub
```bash
git init && git add . && git commit -m "SHBN Printing Service Records"
git branch -M main
git remote add origin https://github.com/<you>/shbn-printing-service-records.git
git push -u origin main
```

### 3. Vercel
1. vercel.com → **Add New → Project** → import the GitHub repo (no framework, no build command; leave defaults).
2. **Environment Variables**:
   - `DATABASE_URL` = your Neon connection string
   - `ADMIN_PASSWORD` = optional, to replace the default `8888`
   - `ACCESS_CODE` = optional shared code (e.g. `7799`). If set, the app asks for it. **Recommended**, because otherwise anyone with the URL can read and add entries.
3. Deploy. Later pushes to `main` redeploy automatically. (Changing an env var requires a redeploy.)

## Run locally (no Vercel or Neon needed)
```bash
npm install
npm run dev        # http://localhost:3000, uses an embedded Postgres in ./.pglite
```
Set `DATABASE_URL` first to run against your real Neon database instead.

## Maintaining the lists
Suppliers and service charges live in the `suppliers` and `services` tables. Edit them in the Neon SQL Editor, e.g.
```sql
update services set charge = 0.60 where name = 'PHOTOCOPY - B&W';
insert into suppliers (name, brand) values ('NEW SUPPLIER SDN BHD', 'NEW BRAND');
```
Past entries keep the old charge.
