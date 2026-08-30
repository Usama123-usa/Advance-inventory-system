-- ============================================================================
-- Migration: Pending Orders (POS + Sales)
--
-- Paste this file into the Supabase SQL Editor and run it AFTER
-- sql/migration_2026-08-29_sale_date_and_tile_pricing.sql has already been
-- applied. Safe to re-run.
--
-- Adds a fulfillment-state flag to sales, separate from payment_status
-- (which tracks money owed, not whether the order itself is finalized):
--   sales.status: 'completed' (default, same as every existing row) | 'pending'
--
-- A Pending Order deducts stock immediately at save time, exactly like a
-- completed sale — it is a real, stock-committed sale row that simply hasn't
-- been marked finalized yet. That means delete_sale() and
-- create_sale_return() already work correctly for pending orders with no
-- changes at all: they operate on any sale row regardless of status.
-- ============================================================================

alter table sales add column if not exists status varchar(20) not null default 'completed'
  check (status in ('completed', 'pending'));

create index if not exists idx_sales_status on sales (status);
create index if not exists idx_sales_store_status on sales (store_id, status);

-- ============================================================================
-- create_sale() — identical to the version in
-- migration_2026-08-29_sale_date_and_tile_pricing.sql, plus one new trailing
-- parameter p_status (defaults to 'completed', so every existing caller is
-- unaffected). The POS "Mark as Pending Order" checkbox is the only caller
-- that ever passes 'pending'.
-- ============================================================================

-- create or replace can't change a function's parameter list — adding
-- p_status as a new trailing parameter would otherwise create a second
-- overload alongside the old 14-param version instead of replacing it
-- (which is what caused "function name create_sale is not unique" on the
-- grant below). Drop every prior signature first so exactly one remains.
drop function if exists create_sale(uuid, uuid, uuid, jsonb, numeric, text, text, text, numeric, text, text, text, text);
drop function if exists create_sale(uuid, uuid, uuid, jsonb, numeric, text, text, text, numeric, text, text, text, text, date);
drop function if exists create_sale(uuid, uuid, uuid, jsonb, numeric, text, text, numeric, text, text, text, text);
drop function if exists create_sale(uuid, uuid, jsonb, numeric, text, text);

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
  p_customer_cnic text default null,
  p_sale_date date default current_date,
  p_status text default 'completed'
) returns sales
language plpgsql as $$
declare
  v_item jsonb;
  v_product products%rowtype;
  v_sp store_products%rowtype;
  v_qty int;
  v_unit_price numeric;
  v_effective_unit_price numeric;
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
  v_sale_date date;
  v_status text;
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

  v_sale_date := coalesce(p_sale_date, current_date);
  v_status := case when p_status = 'pending' then 'pending' else 'completed' end;

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

    if v_product.product_type = 'tiles'
       and v_product.packing_per_box is not null
       and v_product.packing_per_box > 0
       and v_product.square_meter is not null then
      v_effective_unit_price := (v_product.square_meter / v_product.packing_per_box) * v_unit_price;
    else
      v_effective_unit_price := v_unit_price;
    end if;

    perform 1 from store_products where product_id = v_product.id for update;
    select * into v_sp from store_products where store_id = p_store_id and product_id = v_product.id;
    if v_sp.id is null then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_sp.stock < v_qty then
      raise exception 'INSUFFICIENT_STOCK: %', v_product.name using errcode = 'P0001';
    end if;

    v_line_total := round(v_effective_unit_price * v_qty, 2);
    v_subtotal := v_subtotal + v_line_total;

    v_items_prepared := v_items_prepared || jsonb_build_object(
      'product_id', v_product.id,
      'product_name', v_product.name,
      'quantity', v_qty,
      'unit_price', v_effective_unit_price,
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
    customer_name, customer_phone, customer_address, customer_cnic, sale_date, status
  )
  values (
    v_invoice_number, p_store_id, p_customer_id, p_cashier_id, v_subtotal, v_discount, v_tax, v_grand_total,
    p_payment_method, v_payment_status, v_paid_amount, v_remaining_balance, p_notes,
    v_name, v_phone, nullif(trim(coalesce(p_customer_address, '')), ''), nullif(trim(coalesce(p_customer_cnic, '')), ''), v_sale_date, v_status
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
    values (v_balance.id, p_store_id, 'charge', v_remaining_balance, v_sale_date, 'Sale ' || v_invoice_number);

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

grant execute on function create_sale to service_role;

-- ============================================================================
-- update_pending_order() — edits a Pending Order in place: reverts stock for
-- its current line items, replaces them with p_items (same validation/tile
-- formula as create_sale), recomputes totals, and reconciles
-- customer_balances the same way create_sale/delete_sale do. Only allowed
-- while status = 'pending'; the sale keeps its id/invoice_number/created_at.
-- ============================================================================
create or replace function update_pending_order(
  p_store_id uuid,
  p_sale_id uuid,
  p_items jsonb,
  p_discount numeric,
  p_payment_method text,
  p_notes text,
  p_user_id uuid,
  p_paid_amount numeric default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_customer_address text default null,
  p_customer_cnic text default null,
  p_sale_date date default null
) returns sales
language plpgsql as $$
declare
  v_sale sales%rowtype;
  v_old_item record;
  v_sp store_products%rowtype;
  v_new_stock int;
  v_item jsonb;
  v_product products%rowtype;
  v_qty int;
  v_unit_price numeric;
  v_effective_unit_price numeric;
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
  v_sale_date date;
  v_items_prepared jsonb := '[]'::jsonb;
  v_phone text;
  v_name text;
  v_balance customer_balances%rowtype;
  v_customer_id uuid;
  v_old_remaining numeric;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_ITEMS' using errcode = 'P0003';
  end if;

  select * into v_sale from sales where id = p_sale_id and store_id = p_store_id for update;
  if v_sale.id is null then
    raise exception 'SALE_NOT_FOUND' using errcode = 'P0008';
  end if;
  if v_sale.status <> 'pending' then
    raise exception 'SALE_NOT_PENDING' using errcode = 'P0015';
  end if;

  -- Revert stock for every current line item (same pattern as delete_sale()).
  for v_old_item in select * from sale_items where sale_id = p_sale_id loop
    if v_old_item.product_id is not null then
      select * into v_sp from store_products
        where store_id = p_store_id and product_id = v_old_item.product_id for update;

      if v_sp.id is not null then
        v_new_stock := v_sp.stock + v_old_item.quantity;
        update store_products set stock = v_new_stock where id = v_sp.id;

        insert into inventory_logs (store_id, product_id, change_type, quantity, previous_quantity, new_quantity, reason, reference_id, created_by)
        values (
          p_store_id,
          v_old_item.product_id,
          'adjustment',
          v_old_item.quantity,
          v_sp.stock,
          v_new_stock,
          'Pending order ' || v_sale.invoice_number || ' edited',
          p_sale_id,
          p_user_id
        );
      end if;
    end if;
  end loop;

  v_old_remaining := v_sale.remaining_balance;
  if v_old_remaining > 0 and nullif(trim(coalesce(v_sale.customer_phone, '')), '') is not null then
    update customer_balances
      set total_remaining_balance = greatest(total_remaining_balance - v_old_remaining, 0),
          updated_at = now()
      where store_id = p_store_id and customer_phone = v_sale.customer_phone;
  end if;

  delete from sale_items where sale_id = p_sale_id;

  v_sale_date := coalesce(p_sale_date, v_sale.sale_date);

  select tax_rate into v_tax_rate from settings limit 1;
  v_tax_rate := coalesce(v_tax_rate, 0);

  -- Re-validate and insert the new item set (identical logic to create_sale()).
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

    if v_product.product_type = 'tiles'
       and v_product.packing_per_box is not null
       and v_product.packing_per_box > 0
       and v_product.square_meter is not null then
      v_effective_unit_price := (v_product.square_meter / v_product.packing_per_box) * v_unit_price;
    else
      v_effective_unit_price := v_unit_price;
    end if;

    perform 1 from store_products where product_id = v_product.id for update;
    select * into v_sp from store_products where store_id = p_store_id and product_id = v_product.id;
    if v_sp.id is null then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_sp.stock < v_qty then
      raise exception 'INSUFFICIENT_STOCK: %', v_product.name using errcode = 'P0001';
    end if;

    v_line_total := round(v_effective_unit_price * v_qty, 2);
    v_subtotal := v_subtotal + v_line_total;

    v_items_prepared := v_items_prepared || jsonb_build_object(
      'product_id', v_product.id,
      'product_name', v_product.name,
      'quantity', v_qty,
      'unit_price', v_effective_unit_price,
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

  update sales set
    subtotal = v_subtotal,
    discount = v_discount,
    tax = v_tax,
    grand_total = v_grand_total,
    payment_method = coalesce(p_payment_method, payment_method),
    payment_status = v_payment_status,
    paid_amount = v_paid_amount,
    remaining_balance = v_remaining_balance,
    notes = coalesce(p_notes, notes),
    customer_name = v_name,
    customer_phone = v_phone,
    customer_address = nullif(trim(coalesce(p_customer_address, '')), ''),
    customer_cnic = nullif(trim(coalesce(p_customer_cnic, '')), ''),
    sale_date = v_sale_date
  where id = p_sale_id
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
      'Pending order ' || v_sale.invoice_number || ' edited',
      v_sale.id,
      p_user_id
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
    values (v_balance.id, p_store_id, 'charge', v_remaining_balance, v_sale_date, 'Pending order ' || v_sale.invoice_number || ' edited');

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

grant execute on function update_pending_order to service_role;

-- ============================================================================
-- Done. New: sales.status ('completed' default | 'pending'), create_sale()
-- accepts p_status, update_pending_order(). delete_sale() and
-- create_sale_return() are unchanged and already work for pending orders.
-- ============================================================================
