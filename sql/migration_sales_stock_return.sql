-- ============================================================================
-- Migration: Invoice-scoped Stock Return (Sales section)
--
-- Paste this file into the Supabase SQL Editor and run it AFTER
-- sql/migration_stock_returns.sql has already been applied. Safe to re-run.
--
-- The existing stock_returns / stock_return_items tables (from
-- migration_stock_returns.sql) only supported a generic "return any product
-- to stock" flow with no link back to the sale it came from. This migration
-- adds that link plus create_sale_return(), which returns specific line
-- items from a specific invoice: it decrements the sold quantity on the
-- sale_items row directly (so a later return attempt can never exceed what's
-- left), restocks store_products, and recomputes the sale's
-- subtotal/tax/grand_total/paid_amount/remaining_balance/payment_status —
-- exactly the numbers the Sales list and Invoice page already read.
-- ============================================================================

alter table stock_returns add column if not exists sale_id uuid references sales(id) on delete set null;
create index if not exists idx_stock_returns_sale on stock_returns (sale_id);

alter table stock_return_items add column if not exists sale_item_id uuid references sale_items(id) on delete set null;
create index if not exists idx_stock_return_items_sale_item on stock_return_items (sale_item_id);

-- ============================================================================
-- create_sale_return() — row-locks the sale and each targeted sale_item,
-- validates the requested quantity doesn't exceed what's currently on that
-- line, decrements it, restocks store_products, logs an inventory_logs
-- 'return' entry per item (same as delete_sale/create_stock_return), then
-- recomputes the sale's totals from the reduction and reconciles any
-- outstanding customer_balances entry.
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
      select * into v_sp from store_products
        where store_id = p_store_id and product_id = v_si.product_id for update;

      if v_sp.id is not null then
        v_new_stock := v_sp.stock + v_qty;
        update store_products set stock = v_new_stock where id = v_sp.id;

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

grant execute on function create_sale_return to service_role;

-- ============================================================================
-- Done. Changed: stock_returns (+ sale_id), stock_return_items
-- (+ sale_item_id). New: create_sale_return(). Sales returns restock
-- inventory, shrink the sale's line item and totals, and reconcile any
-- outstanding customer balance — all in one transaction.
-- ============================================================================
