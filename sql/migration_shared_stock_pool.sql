-- ============================================================================
-- Migration: Shared stock pool across Main Store + Sub-Stores
--
-- Paste this file into the Supabase SQL Editor and run it AFTER
-- sql/migration_sales_stock_return.sql has already been applied. Safe to
-- re-run.
--
-- Previously each store_products row (store_id, product_id) held its own
-- independent stock number. A product created in the Main Store fanned out
-- to every store, but every store OTHER than Main started at zero — so a
-- product with 134 units in the Main Store showed 0 in every sub-store,
-- even though it's meant to be the same physical inventory.
--
-- This migration makes stock a genuine shared pool: every store_products
-- row for a given product_id now always holds the SAME stock value, kept in
-- sync by every stock-mutating RPC writing to every row for that product
-- instead of just the acting store's row. Existence (which stores carry a
-- product at all) is completely unaffected — that's still controlled purely
-- by which store_products rows exist, unchanged from
-- migration_sales_stock_return.sql's product-creation rules.
--
-- No table/column changes — store_products.stock stays exactly as it is;
-- only the functions that write to it change, so nothing in the API layer
-- or frontend needs to change either.
-- ============================================================================

-- ============================================================================
-- Backfill: for every product that exists in more than one store, converge
-- every one of its store_products rows onto the highest stock value already
-- recorded for it (never discards a recorded quantity — e.g. Main Store 134
-- / Sub Store 0 converges to 134 everywhere). Products that only exist in a
-- single store are untouched.
-- ============================================================================
with pooled as (
  select product_id, max(stock) as pooled_stock
  from store_products
  group by product_id
  having count(*) > 1
)
update store_products sp
set stock = pooled.pooled_stock
from pooled
where sp.product_id = pooled.product_id
  and sp.stock <> pooled.pooled_stock;

-- ============================================================================
-- adjust_stock() — replaces the version from sql/schema.sql. Locks every
-- store_products row for the product (not just p_store_id's) before reading
-- the current value, then writes the new stock to all of them.
-- ============================================================================
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
  perform 1 from store_products where product_id = p_product_id for update;

  select stock into v_current from store_products
    where store_id = p_store_id and product_id = p_product_id;
  if v_current is null then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_new := v_current + p_delta;
  if v_new < 0 then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
  end if;

  update store_products set stock = v_new where product_id = p_product_id;

  insert into inventory_logs (store_id, product_id, change_type, quantity, previous_quantity, new_quantity, reason, reference_id, created_by)
  values (p_store_id, p_product_id, p_change_type, abs(p_delta), v_current, v_new, p_reason, p_reference_id, p_user_id)
  returning * into v_log;

  return v_log;
end;
$$;

-- ============================================================================
-- create_sale() — replaces the version from
-- sql/migration_manual_invoice_number.sql. Same signature/logic; only the
-- stock read/write for each line item now covers the whole pool.
-- ============================================================================
drop function if exists create_sale(uuid, uuid, uuid, jsonb, numeric, text, text, text, numeric, text, text, text, text);

create or replace function create_sale(
  p_store_id uuid,
  p_customer_id uuid,
  p_cashier_id uuid,
  p_items jsonb,
  p_discount numeric,
  p_payment_method text,
  p_notes text,
  p_invoice_number text,
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
  v_unit_price numeric;
  v_subtotal numeric := 0;
  v_line_total numeric;
  v_tax_rate numeric;
  v_discount numeric;
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
  v_name text;
  v_balance customer_balances%rowtype;
  v_customer_id uuid;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_ITEMS' using errcode = 'P0003';
  end if;

  v_invoice_number := nullif(trim(coalesce(p_invoice_number, '')), '');
  if v_invoice_number is null then
    raise exception 'INVOICE_NUMBER_REQUIRED' using errcode = 'P0012';
  end if;

  if exists (select 1 from sales where store_id = p_store_id and invoice_number = v_invoice_number) then
    raise exception 'DUPLICATE_INVOICE_NUMBER' using errcode = 'P0011';
  end if;

  select tax_rate into v_tax_rate from settings limit 1;
  v_tax_rate := coalesce(v_tax_rate, 0);

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'INVALID_QUANTITY' using errcode = 'P0004';
    end if;

    v_unit_price := (v_item->>'unitPrice')::numeric;
    if v_unit_price is null or v_unit_price < 0 then
      raise exception 'INVALID_PRICE' using errcode = 'P0009';
    end if;

    select * into v_product from products where id = (v_item->>'productId')::uuid;
    if v_product.id is null then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
    end if;

    perform 1 from store_products where product_id = v_product.id for update;
    select * into v_sp from store_products where store_id = p_store_id and product_id = v_product.id;
    if v_sp.id is null then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_sp.stock < v_qty then
      raise exception 'INSUFFICIENT_STOCK: %', v_product.name using errcode = 'P0001';
    end if;

    v_line_total := v_unit_price * v_qty;
    v_subtotal := v_subtotal + v_line_total;

    v_items_prepared := v_items_prepared || jsonb_build_object(
      'product_id', v_product.id,
      'product_name', v_product.name,
      'quantity', v_qty,
      'unit_price', v_unit_price,
      'total', v_line_total,
      'previous_quantity', v_sp.stock,
      'new_quantity', v_sp.stock - v_qty,
      'sqr_meter', v_product.sqr_meter,
      'rate_per_meter', v_product.rate_per_meter
    );
  end loop;

  v_discount := greatest(coalesce(p_discount, 0), 0);
  v_taxable := greatest(v_subtotal - v_discount, 0);
  v_tax := round(v_taxable * v_tax_rate / 100, 2);
  v_grand_total := v_taxable + v_tax;

  v_paid_amount := least(greatest(coalesce(p_paid_amount, v_grand_total), 0), v_grand_total);
  v_remaining_balance := v_grand_total - v_paid_amount;
  v_payment_status := case
    when v_remaining_balance <= 0 then 'paid'
    when v_paid_amount <= 0 then 'unpaid'
    else 'partial'
  end;

  v_name := nullif(trim(coalesce(p_customer_name, '')), '');
  v_phone := nullif(trim(coalesce(p_customer_phone, '')), '');

  if v_remaining_balance > 0 and (v_name is null or v_phone is null) then
    raise exception 'CUSTOMER_INFO_REQUIRED' using errcode = 'P0010';
  end if;

  insert into sales (
    invoice_number, store_id, customer_id, cashier_id, subtotal, discount, tax, grand_total,
    payment_method, payment_status, paid_amount, remaining_balance, notes,
    customer_name, customer_phone, customer_address, customer_cnic
  )
  values (
    v_invoice_number, p_store_id, p_customer_id, p_cashier_id, v_subtotal, v_discount, v_tax, v_grand_total,
    p_payment_method, v_payment_status, v_paid_amount, v_remaining_balance, p_notes,
    v_name, v_phone, nullif(trim(coalesce(p_customer_address, '')), ''), nullif(trim(coalesce(p_customer_cnic, '')), '')
  )
  returning * into v_sale;

  for v_item in select * from jsonb_array_elements(v_items_prepared)
  loop
    insert into sale_items (sale_id, product_id, product_name, quantity, unit_price, total, sqr_meter, rate_per_meter)
    values (
      v_sale.id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      (v_item->>'quantity')::int,
      (v_item->>'unit_price')::numeric,
      (v_item->>'total')::numeric,
      (v_item->>'sqr_meter')::numeric,
      (v_item->>'rate_per_meter')::numeric
    );

    update store_products set stock = (v_item->>'new_quantity')::int
      where product_id = (v_item->>'product_id')::uuid;

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
    insert into customer_balances (customer_name, customer_phone, customer_cnic, customer_address, store_id, total_remaining_balance, last_sale_id)
    values (v_name, v_phone, nullif(trim(coalesce(p_customer_cnic, '')), ''), nullif(trim(coalesce(p_customer_address, '')), ''), p_store_id, v_remaining_balance, v_sale.id)
    on conflict (store_id, customer_phone) where customer_phone is not null
    do update set
      total_remaining_balance = customer_balances.total_remaining_balance + excluded.total_remaining_balance,
      customer_name = coalesce(excluded.customer_name, customer_balances.customer_name),
      customer_cnic = coalesce(excluded.customer_cnic, customer_balances.customer_cnic),
      customer_address = coalesce(excluded.customer_address, customer_balances.customer_address),
      last_sale_id = excluded.last_sale_id,
      updated_at = now()
    returning * into v_balance;

    insert into customer_payment_history (customer_balance_id, store_id, entry_type, amount, payment_date, notes)
    values (v_balance.id, p_store_id, 'charge', v_remaining_balance, current_date, 'Sale ' || v_invoice_number);

    select id into v_customer_id from customers where phone = v_phone limit 1;
    if v_customer_id is not null then
      update customers
        set name = v_name,
            address = coalesce(nullif(trim(coalesce(p_customer_address, '')), ''), address),
            updated_at = now()
        where id = v_customer_id;
    else
      insert into customers (name, phone, address)
      values (v_name, v_phone, nullif(trim(coalesce(p_customer_address, '')), ''));
    end if;
  end if;

  return v_sale;
end;
$$;

-- ============================================================================
-- delete_sale() — replaces the version from sql/migration_delete_sale.sql.
-- ============================================================================
create or replace function delete_sale(
  p_store_id uuid,
  p_sale_id uuid,
  p_deleted_by uuid
) returns void
language plpgsql as $$
declare
  v_sale sales%rowtype;
  v_item record;
  v_sp store_products%rowtype;
  v_new_stock int;
begin
  select * into v_sale from sales where id = p_sale_id and store_id = p_store_id for update;
  if v_sale.id is null then
    raise exception 'SALE_NOT_FOUND' using errcode = 'P0008';
  end if;

  for v_item in select * from sale_items where sale_id = p_sale_id loop
    if v_item.product_id is not null then
      perform 1 from store_products where product_id = v_item.product_id for update;
      select * into v_sp from store_products where store_id = p_store_id and product_id = v_item.product_id;

      if v_sp.id is not null then
        v_new_stock := v_sp.stock + v_item.quantity;
        update store_products set stock = v_new_stock where product_id = v_item.product_id;

        insert into inventory_logs (store_id, product_id, change_type, quantity, previous_quantity, new_quantity, reason, reference_id, created_by)
        values (
          p_store_id,
          v_item.product_id,
          'return',
          v_item.quantity,
          v_sp.stock,
          v_new_stock,
          'Sale ' || v_sale.invoice_number || ' deleted',
          p_sale_id,
          p_deleted_by
        );
      end if;
    end if;
  end loop;

  if v_sale.remaining_balance > 0 and nullif(trim(coalesce(v_sale.customer_phone, '')), '') is not null then
    update customer_balances
      set total_remaining_balance = greatest(total_remaining_balance - v_sale.remaining_balance, 0),
          updated_at = now()
      where store_id = p_store_id and customer_phone = v_sale.customer_phone;
  end if;

  delete from sales where id = p_sale_id;
end;
$$;

-- ============================================================================
-- create_stock_return() — replaces the version from
-- sql/migration_stock_returns.sql.
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

    perform 1 from store_products where product_id = v_product_id for update;
    select * into v_sp from store_products where store_id = p_store_id and product_id = v_product_id;

    if v_sp.id is null then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
    end if;

    select unit into v_unit from products where id = v_product_id;

    v_new_stock := v_sp.stock + v_quantity;
    update store_products set stock = v_new_stock where product_id = v_product_id;

    insert into stock_return_items (stock_return_id, product_id, quantity, unit)
    values (v_return_id, v_product_id, v_quantity, v_unit);

    insert into inventory_logs (store_id, product_id, change_type, quantity, previous_quantity, new_quantity, reason, reference_id, created_by)
    values (p_store_id, v_product_id, 'return', v_quantity, v_sp.stock, v_new_stock, coalesce(nullif(trim(p_reason), ''), 'Stock return'), v_return_id, p_user_id);
  end loop;

  return v_return_id;
end;
$$;

-- ============================================================================
-- create_sale_return() — replaces the version from
-- sql/migration_sales_stock_return.sql.
-- ============================================================================
create or replace function create_sale_return(
  p_store_id uuid,
  p_sale_id uuid,
  p_items jsonb,
  p_reason text,
  p_user_id uuid
) returns uuid
language plpgsql as $$
declare
  v_sale sales%rowtype;
  v_return_id uuid;
  v_item jsonb;
  v_sale_item_id uuid;
  v_qty int;
  v_si sale_items%rowtype;
  v_sp store_products%rowtype;
  v_new_item_qty int;
  v_new_item_total numeric;
  v_reduction numeric := 0;
  v_new_stock int;
  v_tax_rate numeric;
  v_new_subtotal numeric;
  v_new_taxable numeric;
  v_new_tax numeric;
  v_new_grand_total numeric;
  v_new_paid numeric;
  v_new_remaining numeric;
  v_new_status text;
  v_old_remaining numeric;
  v_balance_delta numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_ITEMS' using errcode = 'P0003';
  end if;

  select * into v_sale from sales where id = p_sale_id and store_id = p_store_id for update;
  if v_sale.id is null then
    raise exception 'SALE_NOT_FOUND' using errcode = 'P0008';
  end if;

  insert into stock_returns (store_id, sale_id, reason, created_by)
  values (p_store_id, p_sale_id, nullif(trim(coalesce(p_reason, '')), ''), p_user_id)
  returning id into v_return_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_sale_item_id := (v_item->>'saleItemId')::uuid;
    v_qty := (v_item->>'quantity')::int;

    if v_sale_item_id is null or v_qty is null or v_qty <= 0 then
      raise exception 'INVALID_ITEM' using errcode = 'P0004';
    end if;

    select * into v_si from sale_items where id = v_sale_item_id and sale_id = p_sale_id for update;
    if v_si.id is null then
      raise exception 'SALE_ITEM_NOT_FOUND' using errcode = 'P0014';
    end if;

    if v_qty > v_si.quantity then
      raise exception 'RETURN_EXCEEDS_SOLD: %', v_si.product_name using errcode = 'P0013';
    end if;

    v_new_item_qty := v_si.quantity - v_qty;
    v_new_item_total := round(v_si.unit_price * v_new_item_qty, 2);
    v_reduction := v_reduction + (v_si.total - v_new_item_total);

    update sale_items set quantity = v_new_item_qty, total = v_new_item_total where id = v_si.id;

    insert into stock_return_items (stock_return_id, sale_item_id, product_id, quantity, unit)
    values (v_return_id, v_si.id, v_si.product_id, v_qty, (select unit from products where id = v_si.product_id));

    if v_si.product_id is not null then
      perform 1 from store_products where product_id = v_si.product_id for update;
      select * into v_sp from store_products where store_id = p_store_id and product_id = v_si.product_id;

      if v_sp.id is not null then
        v_new_stock := v_sp.stock + v_qty;
        update store_products set stock = v_new_stock where product_id = v_si.product_id;

        insert into inventory_logs (store_id, product_id, change_type, quantity, previous_quantity, new_quantity, reason, reference_id, created_by)
        values (
          p_store_id,
          v_si.product_id,
          'return',
          v_qty,
          v_sp.stock,
          v_new_stock,
          coalesce(nullif(trim(p_reason), ''), 'Sale return: ' || v_sale.invoice_number),
          v_return_id,
          p_user_id
        );
      end if;
    end if;
  end loop;

  select tax_rate into v_tax_rate from settings limit 1;
  v_tax_rate := coalesce(v_tax_rate, 0);

  v_new_subtotal := greatest(v_sale.subtotal - v_reduction, 0);
  v_new_taxable := greatest(v_new_subtotal - v_sale.discount, 0);
  v_new_tax := round(v_new_taxable * v_tax_rate / 100, 2);
  v_new_grand_total := v_new_taxable + v_new_tax;

  v_old_remaining := v_sale.remaining_balance;
  v_new_paid := least(v_sale.paid_amount, v_new_grand_total);
  v_new_remaining := v_new_grand_total - v_new_paid;
  v_new_status := case
    when v_new_remaining <= 0 then 'paid'
    when v_new_paid <= 0 then 'unpaid'
    else 'partial'
  end;

  update sales
    set subtotal = v_new_subtotal,
        tax = v_new_tax,
        grand_total = v_new_grand_total,
        paid_amount = v_new_paid,
        remaining_balance = v_new_remaining,
        payment_status = v_new_status
    where id = p_sale_id;

  v_balance_delta := v_old_remaining - v_new_remaining;
  if v_balance_delta > 0 and nullif(trim(coalesce(v_sale.customer_phone, '')), '') is not null then
    update customer_balances
      set total_remaining_balance = greatest(total_remaining_balance - v_balance_delta, 0),
          updated_at = now()
      where store_id = p_store_id and customer_phone = v_sale.customer_phone;
  end if;

  return v_return_id;
end;
$$;

-- ============================================================================
-- create_sub_store() — replaces the version from sql/schema.sql. When
-- importing the existing catalog into a brand-new sub-store, each product
-- joins the pool at its current shared stock value instead of zero.
-- ============================================================================
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
    select v_store.id, p.id, coalesce(existing.stock, 0)
    from products p
    left join lateral (
      select sp.stock from store_products sp where sp.product_id = p.id limit 1
    ) existing on true
    on conflict (store_id, product_id) do nothing;
  end if;

  return v_store;
end;
$$;

grant execute on function adjust_stock to service_role;
grant execute on function create_sale to service_role;
grant execute on function delete_sale to service_role;
grant execute on function create_stock_return to service_role;
grant execute on function create_sale_return to service_role;
grant execute on function create_sub_store to service_role;

-- ============================================================================
-- Done. Backfilled: store_products.stock converged per product across every
-- store that carries it. Replaced: adjust_stock(), create_sale(),
-- delete_sale(), create_stock_return(), create_sale_return(),
-- create_sub_store() — every stock write now applies to the whole pool for
-- that product instead of a single store's row. No table/column changes.
-- ============================================================================
