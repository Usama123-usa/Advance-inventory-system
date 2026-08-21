-- ============================================================================
-- Migration: Multi-product Stock Return
--
-- Paste this file into the Supabase SQL Editor and run it AFTER
-- sql/migration_delete_sale.sql has already been applied (create_stock_return
-- below follows the same row-locking pattern as delete_sale/adjust_stock).
-- Safe to re-run.
--
-- Adds a standalone "Stock Return" workflow: a header table + line-item
-- table (mirroring sales/sale_items) plus one RPC that restores stock for
-- every selected product atomically and logs each as an inventory_logs
-- 'return' entry (an enum value that already exists, previously only ever
-- written by delete_sale()).
-- ============================================================================

create table if not exists stock_returns (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  reason text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_returns_store on stock_returns (store_id);
create index if not exists idx_stock_returns_created_at on stock_returns (created_at);

create table if not exists stock_return_items (
  id uuid primary key default gen_random_uuid(),
  stock_return_id uuid not null references stock_returns(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit varchar(30),
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_return_items_return on stock_return_items (stock_return_id);
create index if not exists idx_stock_return_items_product on stock_return_items (product_id);

-- ============================================================================
-- create_stock_return() — creates the stock_returns header, then for every
-- {productId, quantity} in p_items: row-locks store_products, adds the
-- quantity back onto stock, records a stock_return_items line, and writes an
-- inventory_logs 'return' entry (reference_id = the stock_returns id) — all
-- in one transaction so a failure on any item rolls back the whole return.
-- ============================================================================
create or replace function create_stock_return(
  p_store_id uuid,
  p_reason text,
  p_items jsonb,
  p_user_id uuid
) returns uuid
language plpgsql as $$
declare
  v_return_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity int;
  v_sp store_products%rowtype;
  v_new_stock int;
  v_unit varchar(30);
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_ITEMS' using errcode = 'P0003';
  end if;

  insert into stock_returns (store_id, reason, created_by)
  values (p_store_id, nullif(trim(coalesce(p_reason, '')), ''), p_user_id)
  returning id into v_return_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'productId')::uuid;
    v_quantity := (v_item->>'quantity')::int;

    if v_product_id is null or v_quantity is null or v_quantity <= 0 then
      raise exception 'INVALID_ITEM' using errcode = 'P0004';
    end if;

    select * into v_sp from store_products
      where store_id = p_store_id and product_id = v_product_id for update;

    if v_sp.id is null then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
    end if;

    select unit into v_unit from products where id = v_product_id;

    v_new_stock := v_sp.stock + v_quantity;
    update store_products set stock = v_new_stock where id = v_sp.id;

    insert into stock_return_items (stock_return_id, product_id, quantity, unit)
    values (v_return_id, v_product_id, v_quantity, v_unit);

    insert into inventory_logs (store_id, product_id, change_type, quantity, previous_quantity, new_quantity, reason, reference_id, created_by)
    values (p_store_id, v_product_id, 'return', v_quantity, v_sp.stock, v_new_stock, coalesce(nullif(trim(p_reason), ''), 'Stock return'), v_return_id, p_user_id);
  end loop;

  return v_return_id;
end;
$$;

grant execute on function create_stock_return to service_role;

-- ============================================================================
-- Done. New: stock_returns, stock_return_items, create_stock_return(). Stock
-- returns increase store_products.stock and are logged like any other
-- inventory movement (change_type = 'return'), so they surface automatically
-- in the existing Inventory > History tab.
-- ============================================================================
