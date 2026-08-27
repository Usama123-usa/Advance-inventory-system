-- ============================================================================
-- Migration: Allow permanently deleting a store even if it has sales or
-- inventory history.
--
-- Paste this file into the Supabase SQL Editor and run it. Safe to re-run.
--
-- sales.store_id and inventory_logs.store_id were NOT NULL with no ON
-- DELETE action, which blocked DELETE /api/stores/:id/permanent with a
-- foreign-key-violation the moment a store had any sales or stock activity.
-- This detaches that history instead of blocking (store_id becomes NULL on
-- those rows), mirroring how sale_items/stock_return_items already handle a
-- deleted product. The sale/log rows themselves are kept, just no longer
-- tied to a store, so they won't appear in that store's reports anymore
-- (the store is gone) but remain in the database.
-- ============================================================================

alter table sales alter column store_id drop not null;
alter table sales drop constraint if exists sales_store_id_fkey;
alter table sales add constraint sales_store_id_fkey
  foreign key (store_id) references stores(id) on delete set null;

alter table inventory_logs alter column store_id drop not null;
alter table inventory_logs drop constraint if exists inventory_logs_store_id_fkey;
alter table inventory_logs add constraint inventory_logs_store_id_fkey
  foreign key (store_id) references stores(id) on delete set null;

-- ============================================================================
-- Done. A store can now be permanently deleted regardless of its sales or
-- inventory history. store_products and expenses still cascade-delete with
-- the store (they are store-scoped by design), and any staff user assigned
-- to the store is detached (store_id set to null) by the delete endpoint.
-- ============================================================================
