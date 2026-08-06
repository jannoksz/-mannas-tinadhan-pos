-- ─────────────────────────────────────────────────────
--  Manna's Tinadhan POS — Supabase schema
--  Run this once in Supabase → SQL Editor → New query
-- ─────────────────────────────────────────────────────

-- ── products ────────────────────────────────────────
create table if not exists products (
  sku        text primary key,
  name       text not null,
  category   text not null,
  price      numeric not null default 0,
  stock      numeric not null default 0,
  min_stock  numeric not null default 5,
  updated_at timestamptz default now()
);

-- ── sales  (one row per item per transaction) ────────
create table if not exists sales (
  id             bigint generated always as identity primary key,
  transaction_id text not null,
  date           text not null,
  time           text not null,
  cashier        text,
  product_name   text not null,
  sku            text not null,
  category       text,
  quantity       numeric not null,
  unit_price     numeric not null,
  subtotal       numeric not null,
  total_amount   numeric not null,
  created_at     timestamptz default now()
);

-- ── sales_summary  (one row per transaction) ─────────
create table if not exists sales_summary (
  id             bigint generated always as identity primary key,
  transaction_id text not null unique,
  date           text not null,
  time           text not null,
  cashier        text,
  total_amount   numeric not null,
  item_count     numeric not null,
  cash           numeric,
  change         numeric,
  created_at     timestamptz default now()
);

-- ── restock_history ───────────────────────────────────
create table if not exists restock_history (
  id            bigint generated always as identity primary key,
  date          text not null,
  time          text not null,
  sku           text not null,
  name          text not null,
  category      text,
  qty_added     numeric not null,
  stock_before  numeric not null,
  stock_after   numeric not null,
  price         numeric not null,
  created_at    timestamptz default now()
);

-- ── price_change_log ──────────────────────────────────
create table if not exists price_change_log (
  id          bigint generated always as identity primary key,
  date        text not null,
  time        text not null,
  sku         text not null,
  name        text not null,
  old_price   numeric not null,
  new_price   numeric not null,
  changed_by  text,
  created_at  timestamptz default now()
);

-- ── stock_adjustments ─────────────────────────────────
create table if not exists stock_adjustments (
  id            bigint generated always as identity primary key,
  date          text not null,
  time          text not null,
  sku           text not null,
  name          text not null,
  adjustment    numeric not null,
  stock_before  numeric not null,
  stock_after   numeric not null,
  reason        text,
  created_at    timestamptz default now()
);

-- ── indexes used by server.js queries ─────────────────
create index if not exists idx_sales_transaction_id on sales (transaction_id);
create index if not exists idx_sales_sku on sales (sku);
create index if not exists idx_sales_summary_date on sales_summary (date);
create index if not exists idx_restock_history_sku on restock_history (sku);

-- ── Row Level Security ─────────────────────────────────
-- Enabled with NO public policies: only requests using the
-- service_role key (used by server.js, never the browser) can
-- read or write. Anonymous/anon-key clients are blocked entirely.
alter table products          enable row level security;
alter table sales             enable row level security;
alter table sales_summary     enable row level security;
alter table restock_history   enable row level security;
alter table price_change_log  enable row level security;
alter table stock_adjustments enable row level security;
