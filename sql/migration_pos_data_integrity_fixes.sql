-- ============================================================================
-- Migration: POS / Pending Payments data-integrity fixes
--
-- Fixes three issues found in audit testing:
--   1. A sale could be completed with payment_status partial/unpaid while
--      leaving the customer name (and phone) blank, creating an untraceable
--      "Unknown" debt in Pending Payments.
--   2. A negative discount was accepted and silently increased the grand
--      total instead of being rejected/clamped.
--   3. Customers who owe money via Pending Payments were never written to
--      the customers table, so they didn't show up when searching Customers.
--
-- Paste this file into the Supabase SQL Editor and run it AFTER
-- sql/migration_pending_payment_history.sql has already been applied.
-- Safe to re-run: every step is guarded (IF NOT EXISTS / IF EXISTS).
-- ============================================================================

-- ============================================================================
-- create_sale() — replaces the version from
-- migration_pending_payment_history.sql. Changes:
--   - Discount is clamped to >= 0 before being subtracted (a negative
--     discount can no longer raise the total).
--   - If the sale would leave a remaining balance, customer name AND phone
--     are now required — rejected up front, before any rows are written, so
--     there's no possibility of an orphaned "Unknown" debt.
--   - When a balance is created/increased, the customer is also found (by
--     phone) or created in the customers table, so anyone who owes money
--     always shows up in the Customers list too.
-- ============================================================================
drop function if exists create_sale(uuid, uuid, uuid, jsonb, numeric, text, text, numeric, text, text, text, text);

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

    select * into v_sp from store_products
      where store_id = p_store_id and product_id = v_product.id for update;
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

  -- A negative discount must never increase the total.
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

  -- Any sale left owing money must be traceable to a real customer — reject
  -- before writing anything rather than leaving an "Unknown" debt behind.
  if v_remaining_balance > 0 and (v_name is null or v_phone is null) then
    raise exception 'CUSTOMER_INFO_REQUIRED' using errcode = 'P0010';
  end if;

  v_invoice_number := 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text), 1, 6));

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
    -- v_phone is guaranteed non-null here (enforced above).
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

    -- Anyone who owes money should also show up in the Customers list —
    -- find by phone, or create them, so Pending Payments and Customers
    -- never drift apart.
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
-- create_customer_balance() — replaces the version from
-- migration_pending_payment_history.sql. Phone is now required (same
-- traceability rule as create_sale), and the customer is also found/created
-- in the customers table so "Add New Customer" shows up in Customers too.
-- ============================================================================
create or replace function create_customer_balance(
  p_store_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_amount numeric,
  p_payment_date date default current_date,
  p_created_by uuid default null
) returns customer_balances
language plpgsql as $$
declare
  v_balance customer_balances%rowtype;
  v_phone text;
  v_name text;
  v_customer_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0006';
  end if;

  v_name := nullif(trim(coalesce(p_customer_name, '')), '');
  v_phone := nullif(trim(coalesce(p_customer_phone, '')), '');

  if v_name is null or v_phone is null then
    raise exception 'CUSTOMER_INFO_REQUIRED' using errcode = 'P0010';
  end if;

  insert into customer_balances (customer_name, customer_phone, customer_address, store_id, total_remaining_balance)
  values (v_name, v_phone, nullif(trim(coalesce(p_customer_address, '')), ''), p_store_id, p_amount)
  on conflict (store_id, customer_phone) where customer_phone is not null
  do update set
    total_remaining_balance = customer_balances.total_remaining_balance + excluded.total_remaining_balance,
    customer_name = coalesce(excluded.customer_name, customer_balances.customer_name),
    customer_address = coalesce(excluded.customer_address, customer_balances.customer_address),
    updated_at = now()
  returning * into v_balance;

  insert into customer_payment_history (customer_balance_id, store_id, entry_type, amount, payment_date, created_by, notes)
  values (v_balance.id, p_store_id, 'charge', p_amount, coalesce(p_payment_date, current_date), p_created_by, 'Manually added');

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

  return v_balance;
end;
$$;

grant execute on function create_customer_balance to service_role;

-- ============================================================================
-- Done. Replaced: create_sale(), create_customer_balance(). No schema
-- changes — customers are matched by phone via a plain SELECT rather than a
-- unique constraint, so this is safe to run even if the existing customers
-- table already has duplicate/blank phone numbers in it.
-- ============================================================================
