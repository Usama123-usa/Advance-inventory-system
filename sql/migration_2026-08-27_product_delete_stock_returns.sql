-- ============================================================================
-- Migration: Allow permanently deleting a product that has Stock Return
-- history.
--
-- Paste this file into the Supabase SQL Editor and run it. Safe to re-run.
--
-- stock_return_items.product_id previously used ON DELETE RESTRICT, which
-- blocked DELETE /api/products/:id (and the bulk-delete endpoint) with a
-- foreign-key-violation the moment a product had ever appeared in a Stock
-- Return. This brings it in line with how sale_items already handles the
-- same situation: the product reference is detached (ON DELETE SET NULL)
-- instead of blocking, and a denormalized product_name is stored on the
-- line item so return history still shows which product it was after the
-- product itself is gone.
-- ============================================================================

alter table stock_return_items add column if not exists product_name text;

update stock_return_items sri
set product_name = p.name
from products p
where sri.product_id = p.id and sri.product_name is null;

alter table stock_return_items alter column product_id drop not null;

alter table stock_return_items drop constraint if exists stock_return_items_product_id_fkey;
alter table stock_return_items
  add constraint stock_return_items_product_id_fkey
  foreign key (product_id) references products(id) on delete set null;

-- create_stock_return() now also stores product_name at creation time, so
-- new returns keep working exactly like sale_items going forward.
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
  v_product_name text;
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

    select name, unit into v_product_name, v_unit from products where id = v_product_id;

    v_new_stock := v_sp.stock + v_quantity;
    update store_products set stock = v_new_stock where id = v_sp.id;

    insert into stock_return_items (stock_return_id, product_id, product_name, quantity, unit)
    values (v_return_id, v_product_id, v_product_name, v_quantity, v_unit);

    insert into inventory_logs (store_id, product_id, change_type, quantity, previous_quantity, new_quantity, reason, reference_id, created_by)
    values (p_store_id, v_product_id, 'return', v_quantity, v_sp.stock, v_new_stock, coalesce(nullif(trim(p_reason), ''), 'Stock return'), v_return_id, p_user_id);
  end loop;

  return v_return_id;
end;
$$;

grant execute on function create_stock_return to service_role;

-- ============================================================================
-- Done. Products can now be permanently deleted even if they have Stock
-- Return history — that history is kept, just with product_id detached and
-- product_name preserved (mirrors sale_items).
-- ============================================================================
