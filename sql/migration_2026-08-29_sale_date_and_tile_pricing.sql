-- ============================================================================
-- Migration: Sale Date field + correct Tile pricing formula
--
-- Paste this file into the Supabase SQL Editor and run it AFTER
-- sql/migration_shared_stock_pool.sql has already been applied. Safe to
-- re-run.
--
-- Part 1 — Sale Date:
-- Adds sales.sale_date (defaults to today, same pattern as
-- customer_payment_history.payment_date) so the cashier can pick/override
-- the date a sale is recorded against, independent of created_at (which
-- keeps tracking the real insert timestamp for auditing/ordering).
--
-- Part 2 — Tile pricing formula fix:
-- The POS cart previously computed a tile line's total client-side as
-- Quantity × Price × Square Meter and sent that already-multiplied number
-- to create_sale() as the line's unitPrice, which the function simply
-- multiplied by quantity again. That formula was wrong. The correct
-- formula, computed once, authoritatively, inside create_sale() itself
-- (never trusting the client's arithmetic) is, for Tiles products only:
--
--   effective unit price = (square_meter / packing_per_box) * price
--   line total            = effective unit price * quantity
--
-- i.e. Total = (Square Meter ÷ Units Per Box) × Total Units × Price.
-- Every other product category is untouched: line total = unit_price * qty,
-- exactly as before. A missing/zero packing_per_box on a tile product would
-- divide by zero, so that case falls back to the plain unit_price * qty
-- calculation instead of erroring out or corrupting the sale.
--
-- From now on the POS client sends the cashier's raw, typed-in price as
-- unitPrice (no more client-side premultiplication by square_meter) —
-- create_sale() is the single source of truth for the tile formula, so
-- frontend display (CartItemRow/POS subtotal) and backend storage can never
-- drift from each other as long as both read the same product fields.
-- ============================================================================

alter table sales add column if not exists sale_date date not null default current_date;
create index if not exists idx_sales_sale_date on sales (sale_date);

drop function if exists create_sale(uuid, uuid, uuid, jsonb, numeric, text, text, text, numeric, text, text, text, text);
drop function if exists create_sale(uuid, uuid, uuid, jsonb, numeric, text, text, text, numeric, text, text, text, text, date);

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
  p_sale_date date default current_date
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

    -- Tiles-only pricing formula: (Square Meter ÷ Units Per Box) × Price,
    -- applied per unit, then multiplied by quantity below. Guarded against
    -- a missing/zero packing_per_box (would otherwise divide by zero) by
    -- falling back to the plain, unadjusted unit price in that case.
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
    customer_name, customer_phone, customer_address, customer_cnic, sale_date
  )
  values (
    v_invoice_number, p_store_id, p_customer_id, p_cashier_id, v_subtotal, v_discount, v_tax, v_grand_total,
    p_payment_method, v_payment_status, v_paid_amount, v_remaining_balance, p_notes,
    v_name, v_phone, nullif(trim(coalesce(p_customer_address, '')), ''), nullif(trim(coalesce(p_customer_cnic, '')), ''), v_sale_date
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
-- Done. New column: sales.sale_date (defaults to today, editable via the
-- POS cart's Date field). create_sale() now: (1) accepts p_sale_date and
-- stores it, (2) independently computes the Tiles pricing formula
-- (Square Meter ÷ Units Per Box) × Quantity × Price from the product's own
-- stored fields instead of trusting a pre-multiplied client value, with a
-- zero/null packing_per_box safely falling back to plain unit_price × qty.
-- ============================================================================
