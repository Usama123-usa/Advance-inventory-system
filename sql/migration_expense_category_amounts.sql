-- ============================================================================
-- Migration: Per-category expense amounts
--
-- Paste this file into the Supabase SQL Editor and run it AFTER
-- sql/migration_expense_categories.sql has already been applied. Safe to
-- re-run.
--
-- expense_category_links previously only recorded which categories applied
-- to an expense, with a single shared expenses.amount for the whole entry.
-- This adds an amount per category link (e.g. Food 5,000 / Traveling 3,000)
-- and replaces save_expense_categories() so the parent expenses.amount is
-- always authoritatively the sum of its category amounts.
-- ============================================================================

alter table expense_category_links add column if not exists amount numeric(12,2) not null default 0 check (amount >= 0);

-- Backfill: split each existing expense's single amount evenly across its
-- already-linked categories so historical rows keep a sane total.
with counts as (
  select expense_id, count(*) as n from expense_category_links group by expense_id
)
update expense_category_links l
set amount = round(e.amount / c.n, 2)
from expenses e, counts c
where l.expense_id = e.id and l.expense_id = c.expense_id and l.amount = 0 and e.amount > 0;

drop function if exists save_expense_categories(uuid, uuid[]);

-- ============================================================================
-- save_expense_categories() — replaces the version from
-- migration_expense_categories.sql. p_categories is now
-- [{"categoryId": uuid, "amount": numeric}, ...] instead of a bare uuid[] —
-- atomically replaces the category+amount set for one expense (delete-then-
-- reinsert) and writes the sum back onto expenses.amount so the parent total
-- can never drift from its category breakdown.
-- ============================================================================
create or replace function save_expense_categories(
  p_expense_id uuid,
  p_categories jsonb
) returns numeric
language plpgsql as $$
declare
  v_item jsonb;
  v_total numeric := 0;
begin
  delete from expense_category_links where expense_id = p_expense_id;

  if p_categories is not null and jsonb_typeof(p_categories) = 'array' then
    for v_item in select * from jsonb_array_elements(p_categories) loop
      insert into expense_category_links (expense_id, category_id, amount)
      values (p_expense_id, (v_item->>'categoryId')::uuid, coalesce((v_item->>'amount')::numeric, 0));

      v_total := v_total + coalesce((v_item->>'amount')::numeric, 0);
    end loop;
  end if;

  update expenses set amount = v_total where id = p_expense_id;

  return v_total;
end;
$$;

grant execute on function save_expense_categories to service_role;

-- ============================================================================
-- Done. Changed: expense_category_links (+ amount). Replaced:
-- save_expense_categories() — now takes {categoryId, amount} pairs and keeps
-- expenses.amount in sync as their sum.
-- ============================================================================
