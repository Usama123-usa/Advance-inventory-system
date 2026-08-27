-- ============================================================================
-- Migration: Tile Product Form — Square Meter (m²) field + Quantity (unit)
--
-- Paste this file into the Supabase SQL Editor and run it. Safe to re-run.
--
-- Adds a per-unit "Square Meter (m²)" attribute to Tiles products, used at
-- POS time to compute Total = Quantity × Price × Square Meter (see
-- client/src/components/pos/CartItemRow.jsx and client/src/pages/POS.jsx).
-- Tiles' quantity is now tracked/labeled as "unit" instead of "box" — this
-- backfills existing tile products' stored unit so the change is visible
-- immediately instead of only after the product is next edited.
-- ============================================================================

alter table products add column if not exists square_meter numeric(12,3);

update products set unit = 'unit' where product_type = 'tiles' and unit = 'box';

-- Let the Tiles form's "Square Meter (m²)" field use the same saved-options
-- dropdown as Size/Glaze/SQR Meter per Box/Packing/Rate per Meter.
alter table tile_field_options drop constraint if exists tile_field_options_field_name_check;
alter table tile_field_options add constraint tile_field_options_field_name_check
  check (field_name in ('size', 'glaze_mate', 'sqr_meter', 'packing_per_box', 'rate_per_meter', 'square_meter'));

-- ============================================================================
-- Done. New column: products.square_meter. Existing tile products now show
-- "unit" instead of "box" wherever their unit is displayed.
-- ============================================================================
