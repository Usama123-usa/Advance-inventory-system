-- ============================================================================
-- Migration: Pending Payments — edit customer details/balance + receive payment
--
-- Paste this file into the Supabase SQL Editor and run it AFTER
-- sql/migration_partial_payments_and_category_types.sql has already been
-- applied. Safe to re-run.
-- ============================================================================

-- ============================================================================
-- record_customer_payment() — applies a payment against a customer's
-- outstanding balance (customer_balances.total_remaining_balance) and, on a
-- best-effort basis, mirrors it onto the linked sale (last_sale_id) so the
-- Sales list/invoice stay consistent for the common case of one open sale
-- per customer.
-- ============================================================================
create or replace function record_customer_payment(
  p_store_id uuid,
  p_balance_id uuid,
  p_amount numeric
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
-- Done. New: record_customer_payment(). Editing a pending payment's customer
-- details (name/phone/CNIC) or manually correcting the outstanding amount is
-- a plain update on customer_balances — no function needed for that.
-- ============================================================================
