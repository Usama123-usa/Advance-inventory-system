-- ============================================================================
-- Premium Inventory Management & POS System
-- Supabase / PostgreSQL Schema  —  Multi-Store Edition
-- Paste this entire file into the Supabase SQL Editor and run it.
-- Safe to re-run on a fresh project OR an existing project running the old
-- single-store schema: every step is guarded (IF NOT EXISTS / IF EXISTS /
-- existence checks), and the products.quantity -> store_products migration
-- only fires once (it detects and removes the legacy columns).
-- ============================================================================

-- Extensions ------------------------------------------------------------
create extension if not exists "pgcrypto";

-- Helper: auto-update updated_at ----------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================================
-- USERS
-- ============================================================================
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null,
  email varchar(160) not null unique,
  password_hash text not null,
  role varchar(20) not null default 'admin' check (role in ('admin', 'staff', 'store_manager')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_email on users (email);

drop trigger if exists trg_users_updated_at on users;
create trigger trg_users_updated_at
  before update on users
  for each row execute function set_updated_at();

-- Widen the role check for projects that already had the old
-- admin/staff-only constraint.
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in ('admin', 'staff', 'store_manager'));

-- ============================================================================
-- DEFAULT ADMIN USER (optional convenience seed)
-- Email: admin@example.com   Password: Admin@123
-- Change the password immediately after first login in a real deployment.
-- Hash below is bcrypt(10) for "Admin@123"
-- ============================================================================
insert into users (name, email, password_hash, role)
select 'Administrator', 'admin@example.com',
  '$2b$10$vGe35NAs7ebunZ7UrXc4G.SooQeFvV4O3AIdEKfM.iHU9YayVxjB6', 'admin'
where not exists (select 1 from users where email = 'admin@example.com');

-- ============================================================================
-- CATEGORIES
-- ============================================================================
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_categories_name unique (name)
);

create index if not exists idx_categories_name on categories (name);

drop trigger if exists trg_categories_updated_at on categories;
create trigger trg_categories_updated_at
  before update on categories
  for each row execute function set_updated_at();

-- ============================================================================
-- PRODUCTS
-- Products are global catalog entries shared across every store. Stock
-- levels are NOT stored here anymore — see STORE_PRODUCTS below. Image
-- upload has also been removed (image_url no longer exists).
-- ============================================================================
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name varchar(160) not null,
  barcode varchar(64) unique,
  sku varchar(64) unique,
  category_id uuid references categories(id) on delete set null,
  purchase_price numeric(12,2) not null default 0 check (purchase_price >= 0),
  selling_price numeric(12,2) not null default 0 check (selling_price >= 0),
  unit varchar(30) not null default 'pcs',
  description text,
  status varchar(20) not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_category on products (category_id);
create index if not exists idx_products_name on products (name);
create index if not exists idx_products_barcode on products (barcode);
create index if not exists idx_products_sku on products (sku);
create index if not exists idx_products_status on products (status);

drop trigger if exists trg_products_updated_at on products;
create trigger trg_products_updated_at
  before update on products
  for each row execute function set_updated_at();

-- ============================================================================
-- STORES
-- One Main Store (created below, owned by the seeded admin) plus any number
-- of Sub Stores created via the create_sub_store() RPC.
-- ============================================================================
create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  name varchar(160) not null,
  owner_user_id uuid references users(id) on delete set null,
  is_main boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only one store may ever be flagged as the Main Store.
create unique index if not exists uq_stores_single_main on stores (is_main) where is_main = true;
create index if not exists idx_stores_is_active on stores (is_active);

drop trigger if exists trg_stores_updated_at on stores;
create trigger trg_stores_updated_at
  before update on stores
  for each row execute function set_updated_at();

insert into stores (name, owner_user_id, is_main, is_active)
select 'Main Store', (select id from users where email = 'admin@example.com' limit 1), true, true
where not exists (select 1 from stores where is_main = true);

-- ============================================================================
-- USERS.store_id
-- Nullable for admin (an admin isn't locked to one store — they can switch).
-- staff/store_manager are always backfilled/assigned to a concrete store.
-- ============================================================================
alter table users add column if not exists store_id uuid references stores(id);

update users set store_id = (select id from stores where is_main = true limit 1)
where store_id is null and role <> 'admin';

create index if not exists idx_users_store_id on users (store_id);

-- ============================================================================
-- STORE_PRODUCTS  (per-store stock levels for the global product catalog)
-- ============================================================================
create table if not exists store_products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  stock integer not null default 0 check (stock >= 0),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_store_products unique (store_id, product_id)
);

alter table store_products add column if not exists is_low_stock boolean
  generated always as (stock <= low_stock_threshold) stored;

create index if not exists idx_store_products_store on store_products (store_id);
create index if not exists idx_store_products_product on store_products (product_id);
create index if not exists idx_store_products_low_stock on store_products (is_low_stock);

drop trigger if exists trg_store_products_updated_at on store_products;
create trigger trg_store_products_updated_at
  before update on store_products
  for each row execute function set_updated_at();

-- One-time migration: if this project still has the legacy products.quantity
-- / low_stock_threshold / image_url columns, copy their values into
-- store_products for the Main Store, then drop them. No-ops on fresh
-- installs (those columns are never created above) and on already-migrated
-- projects (the IF check below finds nothing to do).
do $$
declare
  v_main_store_id uuid;
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'products' and column_name = 'quantity'
  ) then
    select id into v_main_store_id from stores where is_main = true limit 1;

    insert into store_products (store_id, product_id, stock, low_stock_threshold)
    select v_main_store_id, id, coalesce(quantity, 0), coalesce(low_stock_threshold, 5)
    from products
    on conflict (store_id, product_id) do nothing;

    alter table products drop column if exists is_low_stock;
    alter table products drop column if exists quantity;
    alter table products drop column if exists low_stock_threshold;
    alter table products drop column if exists image_url;
  end if;
end $$;

-- ============================================================================
-- INVENTORY LOGS  (stock in / stock out / adjustment / sale movements)
-- ============================================================================
create table if not exists inventory_logs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  change_type varchar(20) not null check (change_type in ('in', 'out', 'adjustment', 'sale', 'return')),
  quantity integer not null,
  previous_quantity integer not null,
  new_quantity integer not null,
  reason text,
  reference_id uuid,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_logs_product on inventory_logs (product_id);
create index if not exists idx_inventory_logs_created_at on inventory_logs (created_at);
create index if not exists idx_inventory_logs_type on inventory_logs (change_type);

alter table inventory_logs add column if not exists store_id uuid references stores(id);

update inventory_logs set store_id = (select id from stores where is_main = true limit 1)
where store_id is null;

alter table inventory_logs alter column store_id set not null;

create index if not exists idx_inventory_logs_store on inventory_logs (store_id);

-- ============================================================================
-- CUSTOMERS  (shared across all stores)
-- ============================================================================
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name varchar(160) not null,
  phone varchar(30),
  email varchar(160),
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customers_name on customers (name);
create index if not exists idx_customers_phone on customers (phone);

drop trigger if exists trg_customers_updated_at on customers;
create trigger trg_customers_updated_at
  before update on customers
  for each row execute function set_updated_at();

-- ============================================================================
-- SALES
-- ============================================================================
create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  invoice_number varchar(40) not null unique,
  customer_id uuid references customers(id) on delete set null,
  cashier_id uuid references users(id) on delete set null,
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  grand_total numeric(12,2) not null default 0,
  payment_method varchar(20) not null default 'cash' check (payment_method in ('cash', 'card', 'bank_transfer')),
  payment_status varchar(20) not null default 'paid' check (payment_status in ('paid', 'pending', 'refunded')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sales_customer on sales (customer_id);
create index if not exists idx_sales_cashier on sales (cashier_id);
create index if not exists idx_sales_created_at on sales (created_at);
create index if not exists idx_sales_invoice_number on sales (invoice_number);

drop trigger if exists trg_sales_updated_at on sales;
create trigger trg_sales_updated_at
  before update on sales
  for each row execute function set_updated_at();

alter table sales add column if not exists store_id uuid references stores(id);

update sales set store_id = (select id from stores where is_main = true limit 1)
where store_id is null;

alter table sales alter column store_id set not null;

create index if not exists idx_sales_store on sales (store_id);
create index if not exists idx_sales_store_created_at on sales (store_id, created_at);

-- ============================================================================
-- SALE ITEMS
-- ============================================================================
create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  product_name varchar(160) not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  total numeric(12,2) not null check (total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_sale_items_sale on sale_items (sale_id);
create index if not exists idx_sale_items_product on sale_items (product_id);

-- ============================================================================
-- SETTINGS  (single-row key/value style table, global — not per store)
-- ============================================================================
create table if not exists settings (
  id uuid primary key default gen_random_uuid(),
  shop_name varchar(160) not null default 'My Shop',
  logo_url text,
  address text,
  phone varchar(30),
  email varchar(160),
  currency varchar(10) not null default 'PKR',
  tax_rate numeric(5,2) not null default 0,
  invoice_footer text default 'Thank you for your business!',
  theme varchar(10) not null default 'light' check (theme in ('light', 'dark')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_settings_updated_at on settings;
create trigger trg_settings_updated_at
  before update on settings
  for each row execute function set_updated_at();

-- Seed a single default settings row if none exists
insert into settings (shop_name, currency, tax_rate)
select 'My Shop', 'PKR', 0
where not exists (select 1 from settings);

-- ============================================================================
-- EXPENSES  (per store — never shared across stores)
-- ============================================================================
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  date date not null default current_date,
  category varchar(20) not null check (category in ('food', 'transport', 'utilities', 'salaries', 'other')),
  description text,
  amount numeric(12,2) not null check (amount >= 0),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_expenses_store on expenses (store_id);
create index if not exists idx_expenses_store_date on expenses (store_id, date);

drop trigger if exists trg_expenses_updated_at on expenses;
create trigger trg_expenses_updated_at
  before update on expenses
  for each row execute function set_updated_at();

-- ============================================================================
-- RPC FUNCTIONS
-- The backend talks to Postgres exclusively through supabase-js (REST),
-- which handles simple CRUD and joins via resource embedding directly.
-- Anything that needs aggregation (SUM/COUNT/GROUP BY), a multi-table
-- transaction, or a row lock is implemented here instead and called via
-- supabase.rpc(...) from Node.
--
-- Several functions below change signature (a leading p_store_id param) vs.
-- the old single-store schema, so their previous overloads are dropped first
-- to avoid PostgREST "function is not unique" ambiguity errors.
-- ============================================================================

drop function if exists adjust_stock(uuid, int, text, text, uuid, uuid);
drop function if exists create_sale(uuid, uuid, jsonb, numeric, text, text);
drop function if exists get_dashboard_summary();
drop function if exists get_best_selling(int);
drop function if exists get_sales_trend(int);
drop function if exists get_sales_report(text, timestamptz, timestamptz);
drop function if exists get_top_products(int, timestamptz, timestamptz);
drop function if exists get_profit_report(timestamptz, timestamptz);

-- Categories list with product counts + total count for pagination
create or replace function get_categories(p_search text default '', p_limit int default 20, p_offset int default 0)
returns table (
  id uuid, name varchar, description text, created_at timestamptz, updated_at timestamptz,
  product_count int, total_count bigint
)
language sql stable as $$
  select c.id, c.name, c.description, c.created_at, c.updated_at,
         count(p.id)::int as product_count,
         count(*) over()::bigint as total_count
  from categories c
  left join products p on p.category_id = c.id
  where (p_search = '' or c.name ilike '%' || p_search || '%')
  group by c.id
  order by c.name asc
  limit p_limit offset p_offset;
$$;

-- Customers list with order stats + total count for pagination (global,
-- not store-scoped — a customer can buy from any store)
create or replace function get_customers(p_search text default '', p_limit int default 20, p_offset int default 0)
returns table (
  id uuid, name varchar, phone varchar, email varchar, address text,
  created_at timestamptz, updated_at timestamptz,
  total_orders int, total_spent numeric, total_count bigint
)
language sql stable as $$
  select c.id, c.name, c.phone, c.email, c.address, c.created_at, c.updated_at,
         coalesce(count(s.id), 0)::int as total_orders,
         coalesce(sum(s.grand_total), 0)::numeric as total_spent,
         count(*) over()::bigint as total_count
  from customers c
  left join sales s on s.customer_id = c.id
  where (
    p_search = '' or c.name ilike '%'||p_search||'%'
    or c.phone ilike '%'||p_search||'%' or c.email ilike '%'||p_search||'%'
  )
  group by c.id
  order by c.created_at desc
  limit p_limit offset p_offset;
$$;

-- Atomic stock in/out: locks the store_products row, validates bounds,
-- updates stock, and writes the audit log entry — all in one transaction.
create or replace function adjust_stock(
  p_store_id uuid,
  p_product_id uuid,
  p_delta int,
  p_change_type text,
  p_reason text,
  p_user_id uuid,
  p_reference_id uuid default null
) returns inventory_logs
language plpgsql as $$
declare
  v_current int;
  v_new int;
  v_log inventory_logs;
begin
  select stock into v_current from store_products
    where store_id = p_store_id and product_id = p_product_id for update;
  if v_current is null then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_new := v_current + p_delta;
  if v_new < 0 then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
  end if;

  update store_products set stock = v_new where store_id = p_store_id and product_id = p_product_id;

  insert into inventory_logs (store_id, product_id, change_type, quantity, previous_quantity, new_quantity, reason, reference_id, created_by)
  values (p_store_id, p_product_id, p_change_type, abs(p_delta), v_current, v_new, p_reason, p_reference_id, p_user_id)
  returning * into v_log;

  return v_log;
end;
$$;

-- Atomic POS checkout: validates stock for every line item (row-locked in
-- store_products for the selling store), computes totals server-side,
-- creates the sale + sale_items, deducts stock, and writes inventory_logs —
-- all inside one transaction so a failure on any item rolls back the sale.
create or replace function create_sale(
  p_store_id uuid,
  p_customer_id uuid,
  p_cashier_id uuid,
  p_items jsonb,
  p_discount numeric,
  p_payment_method text,
  p_notes text
) returns sales
language plpgsql as $$
declare
  v_item jsonb;
  v_product products%rowtype;
  v_sp store_products%rowtype;
  v_qty int;
  v_subtotal numeric := 0;
  v_line_total numeric;
  v_tax_rate numeric;
  v_taxable numeric;
  v_tax numeric;
  v_grand_total numeric;
  v_invoice_number text;
  v_sale sales%rowtype;
  v_items_prepared jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_ITEMS' using errcode = 'P0003';
  end if;

  select tax_rate into v_tax_rate from settings limit 1;
  v_tax_rate := coalesce(v_tax_rate, 0);

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'INVALID_QUANTITY' using errcode = 'P0004';
    end if;

    select * into v_product from products where id = (v_item->>'productId')::uuid;
    if v_product.id is null then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
    end if;

    select * into v_sp from store_products
      where store_id = p_store_id and product_id = v_product.id for update;
    if v_sp.id is null then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_sp.stock < v_qty then
      raise exception 'INSUFFICIENT_STOCK: %', v_product.name using errcode = 'P0001';
    end if;

    v_line_total := v_product.selling_price * v_qty;
    v_subtotal := v_subtotal + v_line_total;

    v_items_prepared := v_items_prepared || jsonb_build_object(
      'product_id', v_product.id,
      'product_name', v_product.name,
      'quantity', v_qty,
      'unit_price', v_product.selling_price,
      'total', v_line_total,
      'previous_quantity', v_sp.stock,
      'new_quantity', v_sp.stock - v_qty
    );
  end loop;

  v_taxable := greatest(v_subtotal - coalesce(p_discount, 0), 0);
  v_tax := round(v_taxable * v_tax_rate / 100, 2);
  v_grand_total := v_taxable + v_tax;

  v_invoice_number := 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text), 1, 6));

  insert into sales (invoice_number, store_id, customer_id, cashier_id, subtotal, discount, tax, grand_total, payment_method, notes)
  values (v_invoice_number, p_store_id, p_customer_id, p_cashier_id, v_subtotal, coalesce(p_discount, 0), v_tax, v_grand_total, p_payment_method, p_notes)
  returning * into v_sale;

  for v_item in select * from jsonb_array_elements(v_items_prepared)
  loop
    insert into sale_items (sale_id, product_id, product_name, quantity, unit_price, total)
    values (
      v_sale.id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      (v_item->>'quantity')::int,
      (v_item->>'unit_price')::numeric,
      (v_item->>'total')::numeric
    );

    update store_products set stock = (v_item->>'new_quantity')::int
      where store_id = p_store_id and product_id = (v_item->>'product_id')::uuid;

    insert into inventory_logs (store_id, product_id, change_type, quantity, previous_quantity, new_quantity, reason, reference_id, created_by)
    values (
      p_store_id,
      (v_item->>'product_id')::uuid,
      'sale',
      (v_item->>'quantity')::int,
      (v_item->>'previous_quantity')::int,
      (v_item->>'new_quantity')::int,
      'Sale ' || v_invoice_number,
      v_sale.id,
      p_cashier_id
    );
  end loop;

  return v_sale;
end;
$$;

-- Dashboard summary counters for a single store (products/low-stock counts
-- come from store_products; expenses are today's / this month's totals for
-- that store so the dashboard needs only one round trip).
create or replace function get_store_dashboard(p_store_id uuid)
returns table (
  total_products int, total_categories int, low_stock_items int,
  today_sales_total numeric, today_sales_count int,
  monthly_sales_total numeric, monthly_sales_count int,
  total_revenue numeric,
  today_expenses numeric, monthly_expenses numeric
)
language sql stable as $$
  select
    (select count(*)::int from store_products where store_id = p_store_id),
    (select count(*)::int from categories),
    (select count(*)::int from store_products where store_id = p_store_id and is_low_stock),
    (select coalesce(sum(grand_total), 0)::numeric from sales where store_id = p_store_id and created_at >= date_trunc('day', now())),
    (select count(*)::int from sales where store_id = p_store_id and created_at >= date_trunc('day', now())),
    (select coalesce(sum(grand_total), 0)::numeric from sales where store_id = p_store_id and created_at >= date_trunc('month', now())),
    (select count(*)::int from sales where store_id = p_store_id and created_at >= date_trunc('month', now())),
    (select coalesce(sum(grand_total), 0)::numeric from sales where store_id = p_store_id),
    (select coalesce(sum(amount), 0)::numeric from expenses where store_id = p_store_id and date = current_date),
    (select coalesce(sum(amount), 0)::numeric from expenses where store_id = p_store_id and date >= date_trunc('month', now())::date);
$$;

-- Best selling products by units sold, scoped to one store
create or replace function get_best_selling(p_store_id uuid, p_limit int default 5)
returns table (id uuid, name varchar, units_sold int, revenue numeric)
language sql stable as $$
  select p.id, p.name, sum(si.quantity)::int as units_sold, sum(si.total)::numeric as revenue
  from sale_items si
  join sales s on s.id = si.sale_id
  join products p on p.id = si.product_id
  where s.store_id = p_store_id
  group by p.id, p.name
  order by units_sold desc
  limit p_limit;
$$;

-- Daily sales totals over a rolling window, scoped to one store (fills in
-- zero-sale days)
create or replace function get_sales_trend(p_store_id uuid, p_days int default 14)
returns table (date date, total numeric)
language sql stable as $$
  select d::date as date, coalesce(sum(s.grand_total), 0)::numeric as total
  from generate_series(now() - (p_days || ' days')::interval, now(), '1 day') d
  left join sales s on date_trunc('day', s.created_at) = date_trunc('day', d) and s.store_id = p_store_id
  group by date
  order by date asc;
$$;

-- Sales report bucketed by day/week/month, scoped to one store
create or replace function get_sales_report(p_store_id uuid, p_period text default 'daily', p_from timestamptz default null, p_to timestamptz default null)
returns table (period date, orders int, subtotal numeric, discount numeric, tax numeric, total numeric)
language plpgsql stable as $$
declare
  v_bucket text;
begin
  v_bucket := case p_period when 'weekly' then 'week' when 'monthly' then 'month' else 'day' end;
  return query execute format($f$
    select date_trunc(%L, created_at)::date as period,
           count(*)::int as orders,
           coalesce(sum(subtotal), 0)::numeric as subtotal,
           coalesce(sum(discount), 0)::numeric as discount,
           coalesce(sum(tax), 0)::numeric as tax,
           coalesce(sum(grand_total), 0)::numeric as total
    from sales
    where store_id = $1 and ($2 is null or created_at >= $2) and ($3 is null or created_at <= $3)
    group by period
    order by period desc
  $f$, v_bucket)
  using p_store_id, p_from, p_to;
end;
$$;

-- Top selling products within an optional date range, scoped to one store
create or replace function get_top_products(p_store_id uuid, p_limit int default 10, p_from timestamptz default null, p_to timestamptz default null)
returns table (product_name varchar, sku varchar, units_sold int, revenue numeric)
language sql stable as $$
  select si.product_name, p.sku, sum(si.quantity)::int as units_sold, sum(si.total)::numeric as revenue
  from sale_items si
  join sales s on s.id = si.sale_id
  left join products p on p.id = si.product_id
  where s.store_id = p_store_id and (p_from is null or s.created_at >= p_from) and (p_to is null or s.created_at <= p_to)
  group by si.product_name, p.sku
  order by units_sold desc
  limit p_limit;
$$;

-- Daily profit report (revenue vs. cost-of-goods-sold at purchase price),
-- scoped to one store
create or replace function get_profit_report(p_store_id uuid, p_from timestamptz default null, p_to timestamptz default null)
returns table (date date, revenue numeric, cost numeric, profit numeric)
language sql stable as $$
  select date_trunc('day', s.created_at)::date as date,
         sum(si.total)::numeric as revenue,
         sum(si.quantity * coalesce(p.purchase_price, 0))::numeric as cost,
         (sum(si.total) - sum(si.quantity * coalesce(p.purchase_price, 0)))::numeric as profit
  from sale_items si
  join sales s on s.id = si.sale_id
  left join products p on p.id = si.product_id
  where s.store_id = p_store_id and (p_from is null or s.created_at >= p_from) and (p_to is null or s.created_at <= p_to)
  group by date
  order by date desc;
$$;

-- Admin-only combined report: per-store revenue, expenses and net profit,
-- plus each store's identity so the frontend can render a breakdown table.
create or replace function get_all_stores_report(p_admin_user_id uuid, p_from timestamptz default null, p_to timestamptz default null)
returns table (
  store_id uuid, store_name varchar, is_main boolean,
  total_sales numeric, total_orders int, total_expenses numeric, net_profit numeric
)
language sql stable as $$
  select
    st.id as store_id,
    st.name as store_name,
    st.is_main,
    coalesce(s.total_sales, 0)::numeric as total_sales,
    coalesce(s.total_orders, 0)::int as total_orders,
    coalesce(e.total_expenses, 0)::numeric as total_expenses,
    (coalesce(s.total_sales, 0) - coalesce(e.total_expenses, 0))::numeric as net_profit
  from stores st
  left join (
    select store_id, sum(grand_total) as total_sales, count(*) as total_orders
    from sales
    where (p_from is null or created_at >= p_from) and (p_to is null or created_at <= p_to)
    group by store_id
  ) s on s.store_id = st.id
  left join (
    select store_id, sum(amount) as total_expenses
    from expenses
    where (p_from is null or date >= p_from::date) and (p_to is null or date <= p_to::date)
    group by store_id
  ) e on e.store_id = st.id
  where st.is_active = true
  order by st.is_main desc, st.name asc;
$$;

-- Atomically creates a Sub Store plus its manager user account, and
-- optionally imports the existing product catalog at zero stock.
create or replace function create_sub_store(
  p_name text,
  p_manager_email text,
  p_manager_password_hash text,
  p_created_by uuid,
  p_import_products boolean default false
) returns stores
language plpgsql as $$
declare
  v_store stores%rowtype;
begin
  insert into stores (name, owner_user_id, is_main, is_active)
  values (p_name, p_created_by, false, true)
  returning * into v_store;

  insert into users (name, email, password_hash, role, store_id)
  values (p_name || ' Manager', lower(trim(p_manager_email)), p_manager_password_hash, 'store_manager', v_store.id);

  if p_import_products then
    insert into store_products (store_id, product_id, stock)
    select v_store.id, p.id, 0
    from products p
    on conflict (store_id, product_id) do nothing;
  end if;

  return v_store;
end;
$$;

grant execute on function get_categories to service_role;
grant execute on function get_customers to service_role;
grant execute on function adjust_stock to service_role;
grant execute on function create_sale to service_role;
grant execute on function get_store_dashboard to service_role;
grant execute on function get_best_selling to service_role;
grant execute on function get_sales_trend to service_role;
grant execute on function get_sales_report to service_role;
grant execute on function get_top_products to service_role;
grant execute on function get_profit_report to service_role;
grant execute on function get_all_stores_report to service_role;
grant execute on function create_sub_store to service_role;

-- ============================================================================
-- STORAGE BUCKET for the shop logo (product image upload has been removed —
-- this bucket now only backs Settings > Store Information > logo upload).
-- Public bucket: reads are public, all writes go through the backend using
-- the service_role key (which bypasses RLS), so no extra storage policies
-- are required.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- ============================================================================
-- Done. Tables: users, categories, products, stores, store_products,
-- inventory_logs, customers, sales, sale_items, settings, expenses
-- ============================================================================
