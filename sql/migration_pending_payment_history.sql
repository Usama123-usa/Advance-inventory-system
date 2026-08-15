-- ============================================================================
-- Migration: Pending Payments — full payment history + manually-added
-- customers
--
-- Problem: customer_balances only ever stored a single running total per
-- customer — there was no ledger of individual charges/payments, and there
-- was no way to add a customer to Pending Payments except indirectly via a
-- partial-payment sale. This migration adds a proper history table plus a
-- dedicated "add customer with an opening balance" RPC, and threads a
-- user-chosen payment_date through both charges and payments.
--
-- Paste this file into the Supabase SQL Editor and run it AFTER
-- sql/migration_manual_cart_pricing.sql and
-- sql/migration_pending_payment_actions.sql have already been applied.
-- Safe to re-run: every step is guarded (IF NOT EXISTS / IF EXISTS).
-- ============================================================================

-- ============================================================================
-- CUSTOMER_BALANCES — add the missing address field (name/phone/CNIC already
-- existed; address never did, even though the sale snapshot has one).
-- ============================================================================
alter table customer_balances add column if not exists customer_address text;

-- ============================================================================
-- CUSTOMER_PAYMENT_HISTORY — append-only ledger per customer_balances row.
-- 'charge' rows increase what's owed (a sale left a balance, or a customer
-- was manually added with an opening balance); 'payment' rows record money
-- received against that balance. Never updated or deleted by the app —
-- balances change, history doesn't.
-- ============================================================================
create table if not exists customer_payment_history (
  id uuid primary key default gen_random_uuid(),
  customer_balance_id uuid not null references customer_balances(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  entry_type varchar(10) not null check (entry_type in ('charge', 'payment')),
  amount numeric(12,2) not null check (amount >= 0),
  payment_date date not null default current_date,
  notes text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_payment_history_balance
  on customer_payment_history (customer_balance_id, created_at);
create index if not exists idx_customer_payment_history_store
  on customer_payment_history (store_id);

-- One-time backfill: every pre-migration balance that still owes something
-- gets a single synthetic 'charge' entry so its history isn't empty. Guarded
-- so it only ever fires for a balance that has no history rows yet — safe
-- to re-run.
insert into customer_payment_history (customer_balance_id, store_id, entry_type, amount, payment_date, notes)
select cb.id, cb.store_id, 'charge', cb.total_remaining_balance, cb.updated_at::date, 'Opening balance (migrated)'
from customer_balances cb
where cb.total_remaining_balance > 0
  and not exists (select 1 from customer_payment_history h where h.customer_balance_id = cb.id);

-- ============================================================================
-- create_sale() — replaces the version from migration_manual_cart_pricing.sql.
-- Identical except: whenever it contributes a new/increased balance to
-- customer_balances, it now also inserts a matching 'charge' row into
-- customer_payment_history so the sale shows up in that customer's ledger.
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
  v_balance customer_balances%rowtype;
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
      insert into customer_balances (customer_name, customer_phone, customer_cnic, customer_address, store_id, total_remaining_balance, last_sale_id)
      values (coalesce(nullif(trim(p_customer_name), ''), 'Unknown'), v_phone, nullif(trim(coalesce(p_customer_cnic, '')), ''), nullif(trim(coalesce(p_customer_address, '')), ''), p_store_id, v_remaining_balance, v_sale.id)
      on conflict (store_id, customer_phone) where customer_phone is not null
      do update set
        total_remaining_balance = customer_balances.total_remaining_balance + excluded.total_remaining_balance,
        customer_name = coalesce(excluded.customer_name, customer_balances.customer_name),
        customer_cnic = coalesce(excluded.customer_cnic, customer_balances.customer_cnic),
        customer_address = coalesce(excluded.customer_address, customer_balances.customer_address),
        last_sale_id = excluded.last_sale_id,
        updated_at = now()
      returning * into v_balance;
    else
      insert into customer_balances (customer_name, customer_phone, customer_cnic, customer_address, store_id, total_remaining_balance, last_sale_id)
      values (coalesce(nullif(trim(p_customer_name), ''), 'Unknown'), null, nullif(trim(coalesce(p_customer_cnic, '')), ''), nullif(trim(coalesce(p_customer_address, '')), ''), p_store_id, v_remaining_balance, v_sale.id)
      returning * into v_balance;
    end if;

    insert into customer_payment_history (customer_balance_id, store_id, entry_type, amount, payment_date, notes)
    values (v_balance.id, p_store_id, 'charge', v_remaining_balance, current_date, 'Sale ' || v_invoice_number);
  end if;

  return v_sale;
end;
$$;

grant execute on function create_sale to service_role;

-- ============================================================================
-- record_customer_payment() — replaces the version from
-- migration_pending_payment_actions.sql. Adds p_payment_date (defaults to
-- today) and p_created_by, and now also writes a 'payment' row to
-- customer_payment_history alongside the existing balance decrement / sale
-- mirroring logic.
-- ============================================================================
drop function if exists record_customer_payment(uuid, uuid, numeric);

create or replace function record_customer_payment(
  p_store_id uuid,
  p_balance_id uuid,
  p_amount numeric,
  p_payment_date date default current_date,
  p_created_by uuid default null
) returns customer_balances
language plpgsql as $$
declare
  v_balance customer_balances%rowtype;
  v_sale sales%rowtype;
  v_applied numeric;
  v_sale_remaining numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0006';
  end if;

  select * into v_balance from customer_balances
    where id = p_balance_id and store_id = p_store_id
    for update;

  if v_balance.id is null then
    raise exception 'BALANCE_NOT_FOUND' using errcode = 'P0005';
  end if;

  if p_amount > v_balance.total_remaining_balance then
    raise exception 'AMOUNT_EXCEEDS_BALANCE' using errcode = 'P0007';
  end if;

  update customer_balances
    set total_remaining_balance = total_remaining_balance - p_amount,
        updated_at = now()
    where id = p_balance_id
    returning * into v_balance;

  insert into customer_payment_history (customer_balance_id, store_id, entry_type, amount, payment_date, created_by)
  values (p_balance_id, p_store_id, 'payment', p_amount, coalesce(p_payment_date, current_date), p_created_by);

  if v_balance.last_sale_id is not null then
    select * into v_sale from sales where id = v_balance.last_sale_id for update;

    if v_sale.id is not null and v_sale.remaining_balance > 0 then
      v_applied := least(p_amount, v_sale.remaining_balance);
      v_sale_remaining := v_sale.remaining_balance - v_applied;

      update sales set
        paid_amount = paid_amount + v_applied,
        remaining_balance = v_sale_remaining,
        payment_status = case when v_sale_remaining <= 0 then 'paid' else 'partial' end
      where id = v_sale.id;
    end if;
  end if;

  return v_balance;
end;
$$;

grant execute on function record_customer_payment to service_role;

-- ============================================================================
-- create_customer_balance() — "Add New Customer" in Pending Payments: records
-- an opening pending amount for a customer that isn't tied to any sale.
-- Upserts on (store_id, customer_phone) exactly like create_sale does, so
-- adding a customer who already has a balance just adds to it instead of
-- creating a duplicate row.
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
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0006';
  end if;

  v_phone := nullif(trim(coalesce(p_customer_phone, '')), '');

  if v_phone is not null then
    insert into customer_balances (customer_name, customer_phone, customer_address, store_id, total_remaining_balance)
    values (coalesce(nullif(trim(p_customer_name), ''), 'Unknown'), v_phone, nullif(trim(coalesce(p_customer_address, '')), ''), p_store_id, p_amount)
    on conflict (store_id, customer_phone) where customer_phone is not null
    do update set
      total_remaining_balance = customer_balances.total_remaining_balance + excluded.total_remaining_balance,
      customer_name = coalesce(excluded.customer_name, customer_balances.customer_name),
      customer_address = coalesce(excluded.customer_address, customer_balances.customer_address),
      updated_at = now()
    returning * into v_balance;
  else
    insert into customer_balances (customer_name, customer_phone, customer_address, store_id, total_remaining_balance)
    values (coalesce(nullif(trim(p_customer_name), ''), 'Unknown'), null, nullif(trim(coalesce(p_customer_address, '')), ''), p_store_id, p_amount)
    returning * into v_balance;
  end if;

  insert into customer_payment_history (customer_balance_id, store_id, entry_type, amount, payment_date, created_by, notes)
  values (v_balance.id, p_store_id, 'charge', p_amount, coalesce(p_payment_date, current_date), p_created_by, 'Manually added');

  return v_balance;
end;
$$;

grant execute on function create_customer_balance to service_role;

-- ============================================================================
-- Done. New: customer_payment_history, create_customer_balance(). Changed:
-- customer_balances (added customer_address). Replaced: create_sale(),
-- record_customer_payment().
-- ============================================================================
