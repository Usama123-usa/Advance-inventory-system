-- ============================================================================
-- Tile Field Options — user-built dropdown lists for the Tiles product form
-- (Size, Glaze/Mate, SQR Meter per box, Packing per box, Rate per Meter)
--
-- Paste this file into the Supabase SQL Editor and run it independently —
-- it does not depend on sql/schema.sql or the other migration file beyond
-- pgcrypto (for gen_random_uuid()), which schema.sql already enables.
-- Safe to re-run: every step is guarded (IF NOT EXISTS).
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists tile_field_options (
  id uuid primary key default gen_random_uuid(),
  field_name text not null check (field_name in ('size', 'glaze_mate', 'sqr_meter', 'packing_per_box', 'rate_per_meter')),
  option_value text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_tile_field_options_field_name on tile_field_options (field_name);

-- Prevents the same value being saved twice under the same field (clicking
-- "Add" on a value that's already in the list is just a harmless no-op).
create unique index if not exists uq_tile_field_options_field_value
  on tile_field_options (field_name, option_value);

-- ============================================================================
-- Done. Table: tile_field_options
-- ============================================================================
