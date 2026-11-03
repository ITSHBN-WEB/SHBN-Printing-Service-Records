-- SHBN - Printing Service Records
create table if not exists suppliers (
  id     serial primary key,
  name   text not null,
  brand  text not null,
  unique (name, brand)
);

create table if not exists services (
  id          serial primary key,
  name        text not null unique,
  charge      numeric(10,2) not null check (charge >= 0),
  sort_order  int not null default 0
);

-- Each entry snapshots supplier / brand / service / charge, so later price
-- or name changes never rewrite history.
create table if not exists entries (
  id            bigserial primary key,
  entry_date    date not null,
  supplier_id   int references suppliers(id) on delete set null,
  supplier      text not null,
  brand         text not null,
  service_id    int references services(id) on delete set null,
  service_type  text not null,
  qty           int not null check (qty > 0),
  charge        numeric(10,2) not null,
  amount        numeric(10,2) not null,
  created_at    timestamptz not null default now()
);

create index if not exists entries_date_idx on entries (entry_date desc, id desc);
