-- ============================================================================
-- Migration: Delete a sale (admin only)
--
-- Paste this file into the Supabase SQL Editor and run it AFTER
-- sql/migration_partial_payments_and_category_types.sql has already been
-- applied. Safe to re-run.
-- ============================================================================

-- ============================================================================
-- delete_sale() — removes a sale and reverses its side effects:
--   - restores the sold quantity back onto store_products.stock
--   - writes a 'return' inventory_logs entry per line item for the audit trail
--   - reverses any outstanding balance this sale contributed to
--     customer_balances (best-effort, matched by phone like create_sale does)
--   - deletes the sale itself (sale_items cascade via their FK)
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
      select * into v_sp from store_products
        where store_id = p_store_id and product_id = v_item.product_id for update;

      if v_sp.id is not null then
        v_new_stock := v_sp.stock + v_item.quantity;
        update store_products set stock = v_new_stock where id = v_sp.id;

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

grant execute on function delete_sale to service_role;

-- ============================================================================
-- Done. New: delete_sale(). Deleting a sale restores stock and reverses any
-- outstanding balance it contributed — the delete itself is irreversible.
-- ============================================================================
