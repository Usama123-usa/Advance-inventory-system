-- ============================================================================
-- Migration: Multi-category expenses
--
-- Paste this file into the Supabase SQL Editor and run it AFTER sql/schema.sql
-- has already been applied. Safe to re-run.
--
-- Adds a proper category catalog + expense<->category junction so a single
-- expense can carry multiple categories, without dropping the legacy
-- expenses.category column or any existing data.
-- ============================================================================

create table if not exists expense_categories (
  id uuid primary key default gen_random_uuid(),
  name varchar(60) not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into expense_categories (name)
values ('Food'), ('Salary'), ('Traveling'), ('Electricity'), ('Rent'), ('Maintenance'), ('Other')
on conflict (name) do nothing;

create table if not exists expense_category_links (
  expense_id uuid not null references expenses(id) on delete cascade,
  category_id uuid not null references expense_categories(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (expense_id, category_id)
);

create index if not exists idx_expense_category_links_category on expense_category_links (category_id);

-- The old single-value enum can't represent the new named categories
-- (Salary/Traveling/Electricity/Rent/Maintenance have no 1:1 legacy slot),
-- so the CHECK constraint is dropped and the column relaxed to nullable.
-- The column itself is kept intact for any existing reports/data relying on it.
alter table expenses drop constraint if exists expenses_category_check;
alter table expenses alter column category drop not null;

-- Backfill: link every existing expense to its best-matching new category so
-- pre-migration expenses still show a category in the UI.
insert into expense_category_links (expense_id, category_id)
select e.id, ec.id
from expenses e
join expense_categories ec on ec.name = case e.category
  when 'food' then 'Food'
  when 'transport' then 'Traveling'
  when 'utilities' then 'Electricity'
  when 'salaries' then 'Salary'
  when 'other' then 'Other'
  else 'Other'
end
where e.category is not null
on conflict do nothing;

-- ============================================================================
-- save_expense_categories() — atomically replaces the category set for one
-- expense (delete-then-reinsert). Used by both createExpense and
-- updateExpense so the link rows are always written in a single transaction.
-- ============================================================================
create or replace function save_expense_categories(
  p_expense_id uuid,
  p_category_ids uuid[]
) returns void
language plpgsql as $$
begin
  delete from expense_category_links where expense_id = p_expense_id;

  if p_category_ids is not null and array_length(p_category_ids, 1) > 0 then
    insert into expense_category_links (expense_id, category_id)
    select p_expense_id, unnest(p_category_ids);
  end if;
end;
$$;

grant execute on function save_expense_categories to service_role;

-- ============================================================================
-- Done. New: expense_categories, expense_category_links, save_expense_categories().
-- Changed: expenses.category is now nullable and unconstrained (legacy data
-- preserved and backfilled into the new junction table).
-- ============================================================================
