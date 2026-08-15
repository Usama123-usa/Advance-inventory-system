-- ============================================================================
-- Migration: Manual invoice numbers
--
-- Problem: create_sale() always generated its own invoice number
-- ('INV-YYYYMMDD-xxxxxx'). The business wants to type their own invoice
-- number for every sale, using their own numbering system, instead of an
-- auto-generated one.
--
-- Changes:
--   - invoice_number is no longer generated — it's a required input,
--     validated for uniqueness before the sale is written.
--   - Uniqueness moves from a global constraint to per-store: two different
--     stores can now use the same invoice number (each store's numbering is
--     independent), matching how store switching separates all other data.
--   - A clear, specific error is raised for a blank or duplicate invoice
--     number, instead of a generic "record already exists" message.
--
-- Paste this file into the Supabase SQL Editor and run it AFTER
-- sql/migration_pos_data_integrity_fixes.sql has already been applied.
-- Safe to re-run: every step is guarded (IF NOT EXISTS / IF EXISTS). Existing
-- sales keep their invoice numbers unchanged — this only changes how NEW
-- sales get theirs, and re-scopes the uniqueness check to be per-store
-- (which every existing globally-unique invoice number already satisfies).
-- ============================================================================

-- ============================================================================
-- SALES — drop the old global "invoice_number must be unique across every
-- store" constraint, replace with a per-store one.
-- ============================================================================
alter table sales drop constraint if exists sales_invoice_number_key;

create unique index if not exists uq_sales_store_invoice_number
  on sales (store_id, invoice_number);

-- ============================================================================
-- create_sale() — replaces the version from
-- migration_pos_data_integrity_fixes.sql. Adds a required p_invoice_number
-- parameter (must go before the already-defaulted trailing params, per
-- PL/pgSQL's parameter-ordering rule) and removes the random-generation
-- logic. Validates the number is non-blank and not already used by this
-- store before writing anything. Everything else — discount clamping,
-- customer-name/phone requirement on a partial sale, linking a balance into
-- the customers table — is unchanged from the previous migration.
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
-- Done. Changed: sales (per-store unique index instead of global). Replaced:
-- create_sale() — invoice_number is now a required, manually-entered,
-- per-store-unique input instead of an auto-generated value.
-- ============================================================================
