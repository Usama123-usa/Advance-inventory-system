-- ============================================================================
-- Migration: Partial Payments / Customer Balances + Category Types
--   (Tiles vs Other product forms)
--
-- Paste this file into the Supabase SQL Editor and run it AFTER
-- sql/schema.sql has already been applied. Safe to re-run: every step is
-- guarded (IF NOT EXISTS / IF EXISTS), matching the style of schema.sql.
-- This file only contains what changed — it is NOT a full schema rewrite.
-- ============================================================================

-- ============================================================================
-- SALES — partial payment tracking + optional free-text customer snapshot
-- ============================================================================
alter table sales add column if not exists paid_amount numeric(12,2) not null default 0;
alter table sales add column if not exists remaining_balance numeric(12,2) not null default 0;
alter table sales add column if not exists customer_name text;
alter table sales add column if not exists customer_phone text;
alter table sales add column if not exists customer_address text;
alter table sales add column if not exists customer_cnic text;

-- Widen payment_status to also cover partial/unpaid (keeps the old
-- pending/refunded values so nothing existing breaks).
alter table sales drop constraint if exists sales_payment_status_check;
alter table sales add constraint sales_payment_status_check
  check (payment_status in ('paid', 'partial', 'unpaid', 'pending', 'refunded'));

-- Backfill: rows created before this migration were always full payments.
-- Self-limiting — once backfilled, paid_amount is no longer 0 so re-running
-- this is a no-op for those rows.
update sales
set paid_amount = grand_total, remaining_balance = 0
where payment_status = 'paid' and paid_amount = 0 and remaining_balance = 0 and grand_total > 0;

create index if not exists idx_sales_payment_status on sales (payment_status);

-- ============================================================================
-- CUSTOMER_BALANCES — cumulative unpaid balance per customer, per store
-- Matched by (store_id, customer_phone) when a phone is given; sales with no
-- phone can't be reliably merged with a prior balance, so each becomes its
-- own row (best-effort — there's no customer identity beyond name/phone/CNIC).
-- ============================================================================
create table if not exists customer_balances (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null default 'Unknown',
  customer_phone text,
  customer_cnic text,
  store_id uuid not null references stores(id) on delete cascade,
  total_remaining_balance numeric(12,2) not null default 0 check (total_remaining_balance >= 0),
  last_sale_id uuid references sales(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_customer_balances_store_phone
  on customer_balances (store_id, customer_phone) where customer_phone is not null;
create index if not exists idx_customer_balances_store on customer_balances (store_id);
create index if not exists idx_customer_balances_remaining on customer_balances (total_remaining_balance);

drop trigger if exists trg_customer_balances_updated_at on customer_balances;
create trigger trg_customer_balances_updated_at
  before update on customer_balances
  for each row execute function set_updated_at();

-- ============================================================================
-- CATEGORIES — required "type" (tiles | other), drives which Product form
-- the frontend renders. Existing categories default to 'other'.
-- ============================================================================
alter table categories add column if not exists type varchar(10) not null default 'other';

alter table categories drop constraint if exists categories_type_check;
alter table categories add constraint categories_type_check check (type in ('tiles', 'other'));

-- get_categories() must return the new type column too (Products.jsx needs
-- it to pick the right form) — return-table columns changed, so drop first.
drop function if exists get_categories(text, int, int);

create or replace function get_categories(p_search text default '', p_limit int default 20, p_offset int default 0)
returns table (
  id uuid, name varchar, description text, type varchar, created_at timestamptz, updated_at timestamptz,
  product_count int, total_count bigint
)
language sql stable as $$
  select c.id, c.name, c.description, c.type, c.created_at, c.updated_at,
         count(p.id)::int as product_count,
         count(*) over()::bigint as total_count
  from categories c
  left join products p on p.category_id = c.id
  where (p_search = '' or c.name ilike '%' || p_search || '%')
  group by c.id
  order by c.name asc
  limit p_limit offset p_offset;
$$;

grant execute on function get_categories to service_role;

-- ============================================================================
-- PRODUCTS — nullable fields for the Tiles form and the Other form. A given
-- product only ever populates the set relevant to its product_type; the rest
-- stay null.
-- ============================================================================
alter table products add column if not exists product_type varchar(10);
alter table products add column if not exists size text;
alter table products add column if not exists glaze_grade text;
alter table products add column if not exists sqr_meter numeric(12,3);
alter table products add column if not exists packing_per_box numeric(12,3);
alter table products add column if not exists rate_per_meter numeric(12,2);
alter table products add column if not exists article text;
alter table products add column if not exists company text;
alter table products add column if not exists unit_type varchar(10);

alter table products drop constraint if exists products_product_type_check;
alter table products add constraint products_product_type_check
  check (product_type is null or product_type in ('tiles', 'other'));

alter table products drop constraint if exists products_unit_type_check;
alter table products add constraint products_unit_type_check
  check (unit_type is null or unit_type in ('box', 'pcs'));

create index if not exists idx_products_product_type on products (product_type);

-- ============================================================================
-- create_sale() — replaces the multi-store version from schema.sql. Adds
-- p_paid_amount (defaults to full payment when omitted) and the free-text
-- customer snapshot fields, computes remaining_balance/payment_status, and
-- upserts customer_balances when a balance is left owing.
-- ============================================================================
drop function if exists create_sale(uuid, uuid, uuid, jsonb, numeric, text, text);

create or replace function create_sale(
  p_store_id uuid,
  p_customer_id uuid,
  p_cashier_id uuid,
  p_items jsonb,
  p_discount numeric,
  p_payment_method text,
  p_notes text,
  p_paid_amount numeric default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_customer_address text default null,
  p_customer_cnic text default null
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
  v_paid_amount numeric;
  v_remaining_balance numeric;
  v_payment_status text;
  v_invoice_number text;
  v_sale sales%rowtype;
  v_items_prepared jsonb := '[]'::jsonb;
  v_phone text;
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

  -- Omitting p_paid_amount means "paid in full" (unchanged behavior for
  -- existing callers). Clamp into [0, grand_total] so remaining_balance
  -- never goes negative and can't exceed the sale total.
  v_paid_amount := least(greatest(coalesce(p_paid_amount, v_grand_total), 0), v_grand_total);
  v_remaining_balance := v_grand_total - v_paid_amount;
  v_payment_status := case
    when v_remaining_balance <= 0 then 'paid'
    when v_paid_amount <= 0 then 'unpaid'
    else 'partial'
  end;

  v_invoice_number := 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text), 1, 6));

  insert into sales (
    invoice_number, store_id, customer_id, cashier_id, subtotal, discount, tax, grand_total,
    payment_method, payment_status, paid_amount, remaining_balance, notes,
    customer_name, customer_phone, customer_address, customer_cnic
  )
  values (
    v_invoice_number, p_store_id, p_customer_id, p_cashier_id, v_subtotal, coalesce(p_discount, 0), v_tax, v_grand_total,
    p_payment_method, v_payment_status, v_paid_amount, v_remaining_balance, p_notes,
    nullif(trim(coalesce(p_customer_name, '')), ''), nullif(trim(coalesce(p_customer_phone, '')), ''),
    nullif(trim(coalesce(p_customer_address, '')), ''), nullif(trim(coalesce(p_customer_cnic, '')), '')
  )
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

  if v_remaining_balance > 0 then
    v_phone := nullif(trim(coalesce(p_customer_phone, '')), '');

    if v_phone is not null then
      insert into customer_balances (customer_name, customer_phone, customer_cnic, store_id, total_remaining_balance, last_sale_id)
      values (coalesce(nullif(trim(p_customer_name), ''), 'Unknown'), v_phone, nullif(trim(coalesce(p_customer_cnic, '')), ''), p_store_id, v_remaining_balance, v_sale.id)
      on conflict (store_id, customer_phone) where customer_phone is not null
      do update set
        total_remaining_balance = customer_balances.total_remaining_balance + excluded.total_remaining_balance,
        customer_name = coalesce(excluded.customer_name, customer_balances.customer_name),
        customer_cnic = coalesce(excluded.customer_cnic, customer_balances.customer_cnic),
        last_sale_id = excluded.last_sale_id,
        updated_at = now();
    else
      insert into customer_balances (customer_name, customer_phone, customer_cnic, store_id, total_remaining_balance, last_sale_id)
      values (coalesce(nullif(trim(p_customer_name), ''), 'Unknown'), null, nullif(trim(coalesce(p_customer_cnic, '')), ''), p_store_id, v_remaining_balance, v_sale.id);
    end if;
  end if;

  return v_sale;
end;
$$;

grant execute on function create_sale to service_role;

-- ============================================================================
-- Done. Changed: sales, categories, products. New: customer_balances.
-- ============================================================================
