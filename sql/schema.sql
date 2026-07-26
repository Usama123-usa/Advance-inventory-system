-- ============================================================================
-- Premium Inventory Management & POS System
-- Supabase / PostgreSQL Schema
-- Paste this entire file into the Supabase SQL Editor and run it.
-- Safe to re-run: uses DROP ... IF EXISTS guards via CREATE TABLE IF NOT EXISTS
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
  role varchar(20) not null default 'admin' check (role in ('admin', 'staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_email on users (email);

drop trigger if exists trg_users_updated_at on users;
create trigger trg_users_updated_at
  before update on users
  for each row execute function set_updated_at();

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
-- ============================================================================
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name varchar(160) not null,
  barcode varchar(64) unique,
  sku varchar(64) unique,
  category_id uuid references categories(id) on delete set null,
  purchase_price numeric(12,2) not null default 0 check (purchase_price >= 0),
  selling_price numeric(12,2) not null default 0 check (selling_price >= 0),
  quantity integer not null default 0 check (quantity >= 0),
  unit varchar(30) not null default 'pcs',
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  image_url text,
  description text,
  status varchar(20) not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Computed column so "low stock" can be filtered/selected directly via the
-- Supabase REST client (PostgREST can't compare two columns of the same row
-- in a filter, so we materialize the comparison here instead).
alter table products add column if not exists is_low_stock boolean
  generated always as (quantity <= low_stock_threshold) stored;

create index if not exists idx_products_category on products (category_id);
create index if not exists idx_products_name on products (name);
create index if not exists idx_products_barcode on products (barcode);
create index if not exists idx_products_sku on products (sku);
create index if not exists idx_products_status on products (status);
create index if not exists idx_products_is_low_stock on products (is_low_stock);

drop trigger if exists trg_products_updated_at on products;
create trigger trg_products_updated_at
  before update on products
  for each row execute function set_updated_at();

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

-- ============================================================================
-- CUSTOMERS
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
-- SETTINGS  (single-row key/value style table for store + system settings)
-- ============================================================================
create table if not exists settings (
  id uuid primary key default gen_random_uuid(),
  shop_name varchar(160) not null default 'My Shop',
  logo_url text,
  address text,
  phone varchar(30),
  email varchar(160),
  currency varchar(10) not null default 'USD',
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
select 'My Shop', 'USD', 0
where not exists (select 1 from settings);

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
-- RPC FUNCTIONS
-- The backend talks to Postgres exclusively through supabase-js (REST),
-- which handles simple CRUD and joins via resource embedding directly.
-- Anything that needs aggregation (SUM/COUNT/GROUP BY), a multi-table
-- transaction, or a row lock is implemented here instead and called via
-- supabase.rpc(...) from Node.
-- ============================================================================

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

-- Customers list with order stats + total count for pagination
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

-- Atomic stock in/out: locks the product row, validates bounds, updates
-- quantity, and writes the audit log entry — all inside one transaction.
create or replace function adjust_stock(
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
  select quantity into v_current from products where id = p_product_id for update;
  if v_current is null then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_new := v_current + p_delta;
  if v_new < 0 then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
  end if;

  update products set quantity = v_new where id = p_product_id;

  insert into inventory_logs (product_id, change_type, quantity, previous_quantity, new_quantity, reason, reference_id, created_by)
  values (p_product_id, p_change_type, abs(p_delta), v_current, v_new, p_reason, p_reference_id, p_user_id)
  returning * into v_log;

  return v_log;
end;
$$;

-- Atomic POS checkout: validates stock for every line item (row-locked),
-- computes totals server-side, creates the sale + sale_items, deducts stock,
-- and writes inventory_logs — all inside one transaction so a failure on any
-- item rolls back the entire sale.
create or replace function create_sale(
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

    select * into v_product from products where id = (v_item->>'productId')::uuid for update;
    if v_product.id is null then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_product.quantity < v_qty then
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
      'previous_quantity', v_product.quantity,
      'new_quantity', v_product.quantity - v_qty
    );
  end loop;

  v_taxable := greatest(v_subtotal - coalesce(p_discount, 0), 0);
  v_tax := round(v_taxable * v_tax_rate / 100, 2);
  v_grand_total := v_taxable + v_tax;

  v_invoice_number := 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text), 1, 6));

  insert into sales (invoice_number, customer_id, cashier_id, subtotal, discount, tax, grand_total, payment_method, notes)
  values (v_invoice_number, p_customer_id, p_cashier_id, v_subtotal, coalesce(p_discount, 0), v_tax, v_grand_total, p_payment_method, p_notes)
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

    update products set quantity = (v_item->>'new_quantity')::int where id = (v_item->>'product_id')::uuid;

    insert into inventory_logs (product_id, change_type, quantity, previous_quantity, new_quantity, reason, reference_id, created_by)
    values (
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

-- Dashboard summary counters
create or replace function get_dashboard_summary()
returns table (
  total_products int, total_categories int, low_stock_items int,
  today_sales_total numeric, today_sales_count int,
  monthly_sales_total numeric, monthly_sales_count int,
  total_revenue numeric
)
language sql stable as $$
  select
    (select count(*)::int from products),
    (select count(*)::int from categories),
    (select count(*)::int from products where is_low_stock),
    (select coalesce(sum(grand_total), 0)::numeric from sales where created_at >= date_trunc('day', now())),
    (select count(*)::int from sales where created_at >= date_trunc('day', now())),
    (select coalesce(sum(grand_total), 0)::numeric from sales where created_at >= date_trunc('month', now())),
    (select count(*)::int from sales where created_at >= date_trunc('month', now())),
    (select coalesce(sum(grand_total), 0)::numeric from sales);
$$;

-- Best selling products by units sold
create or replace function get_best_selling(p_limit int default 5)
returns table (id uuid, name varchar, image_url text, units_sold int, revenue numeric)
language sql stable as $$
  select p.id, p.name, p.image_url, sum(si.quantity)::int as units_sold, sum(si.total)::numeric as revenue
  from sale_items si
  join products p on p.id = si.product_id
  group by p.id
  order by units_sold desc
  limit p_limit;
$$;

-- Daily sales totals over a rolling window (fills in zero-sale days)
create or replace function get_sales_trend(p_days int default 14)
returns table (date date, total numeric)
language sql stable as $$
  select d::date as date, coalesce(sum(s.grand_total), 0)::numeric as total
  from generate_series(now() - (p_days || ' days')::interval, now(), '1 day') d
  left join sales s on date_trunc('day', s.created_at) = date_trunc('day', d)
  group by date
  order by date asc;
$$;

-- Sales report bucketed by day/week/month
create or replace function get_sales_report(p_period text default 'daily', p_from timestamptz default null, p_to timestamptz default null)
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
    where ($1 is null or created_at >= $1) and ($2 is null or created_at <= $2)
    group by period
    order by period desc
  $f$, v_bucket)
  using p_from, p_to;
end;
$$;

-- Top selling products within an optional date range
create or replace function get_top_products(p_limit int default 10, p_from timestamptz default null, p_to timestamptz default null)
returns table (product_name varchar, sku varchar, units_sold int, revenue numeric)
language sql stable as $$
  select si.product_name, p.sku, sum(si.quantity)::int as units_sold, sum(si.total)::numeric as revenue
  from sale_items si
  join sales s on s.id = si.sale_id
  left join products p on p.id = si.product_id
  where (p_from is null or s.created_at >= p_from) and (p_to is null or s.created_at <= p_to)
  group by si.product_name, p.sku
  order by units_sold desc
  limit p_limit;
$$;

-- Daily profit report (revenue vs. cost-of-goods-sold at purchase price)
create or replace function get_profit_report(p_from timestamptz default null, p_to timestamptz default null)
returns table (date date, revenue numeric, cost numeric, profit numeric)
language sql stable as $$
  select date_trunc('day', s.created_at)::date as date,
         sum(si.total)::numeric as revenue,
         sum(si.quantity * coalesce(p.purchase_price, 0))::numeric as cost,
         (sum(si.total) - sum(si.quantity * coalesce(p.purchase_price, 0)))::numeric as profit
  from sale_items si
  join sales s on s.id = si.sale_id
  left join products p on p.id = si.product_id
  where (p_from is null or s.created_at >= p_from) and (p_to is null or s.created_at <= p_to)
  group by date
  order by date desc;
$$;

grant execute on function get_categories to service_role;
grant execute on function get_customers to service_role;
grant execute on function adjust_stock to service_role;
grant execute on function create_sale to service_role;
grant execute on function get_dashboard_summary to service_role;
grant execute on function get_best_selling to service_role;
grant execute on function get_sales_trend to service_role;
grant execute on function get_sales_report to service_role;
grant execute on function get_top_products to service_role;
grant execute on function get_profit_report to service_role;

-- ============================================================================
-- STORAGE BUCKET for product images / shop logo
-- Public bucket: reads are public, all writes go through the backend using
-- the service_role key (which bypasses RLS), so no extra storage policies
-- are required.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- ============================================================================
-- Done. Tables created: users, categories, products, inventory_logs,
-- customers, sales, sale_items, settings
-- ============================================================================
