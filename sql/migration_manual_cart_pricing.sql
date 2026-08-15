-- ============================================================================
-- Migration: Manual cart pricing
--
-- Problem: create_sale() has always priced every line item itself, from
-- products.selling_price (or, for Tiles, sqr_meter x rate_per_meter) —
-- whatever price the cashier saw in the POS cart was cosmetic only. The
-- product now requires the cashier to type the selling price for each item
-- directly in the cart at sale time, and that typed price must become the
-- price of record on the invoice permanently (never recomputed from the
-- product catalog later).
--
-- Paste this file into the Supabase SQL Editor and run it AFTER
-- sql/migration_tile_rate_per_meter_pricing.sql has already been applied.
-- Safe to re-run: every step is guarded (IF NOT EXISTS / IF EXISTS).
-- ============================================================================

-- ============================================================================
-- create_sale() — replaces the version from
-- migration_tile_rate_per_meter_pricing.sql. Only the per-item pricing block
-- changed: unit_price now comes directly from the client-submitted item
-- (p_items[].unitPrice) instead of products.selling_price or a tiles rate
-- calculation. Everything else (stock validation, partial payments,
-- customer snapshot, customer_balances) is unchanged. sqr_meter/rate_per_meter
-- are still snapshotted onto sale_items for Tiles products, but purely as
-- reference info — they no longer drive the charged price.
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

  v_taxable := greatest(v_subtotal - coalesce(p_discount, 0), 0);
  v_tax := round(v_taxable * v_tax_rate / 100, 2);
  v_grand_total := v_taxable + v_tax;

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
-- Done. Replaced: create_sale() now prices every line item from the
-- cart-entered unitPrice instead of products.selling_price / tile rate math.
-- No columns dropped — products.selling_price stays in the table (unused by
-- this function going forward) so no historical data is affected.
-- ============================================================================
