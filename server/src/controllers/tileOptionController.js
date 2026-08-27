const { supabase } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { assertNoSupabaseError } = require('../utils/supabaseErrors');

const FIELD_NAMES = ['size', 'glaze_mate', 'sqr_meter', 'packing_per_box', 'rate_per_meter', 'square_meter'];

// GET /api/tile-options  (all fields) or /api/tile-options?field=size (one field)
const getTileOptions = asyncHandler(async (req, res) => {
  const { field } = req.query;
  if (field && !FIELD_NAMES.includes(field)) {
    throw new ApiError(400, 'Invalid field name');
  }

  let queryBuilder = supabase.from('tile_field_options').select('*').order('option_value', { ascending: true });
  if (field) queryBuilder = queryBuilder.eq('field_name', field);

  const { data, error } = await queryBuilder;
  assertNoSupabaseError(error, 'Failed to load tile options');
  res.json({ success: true, data });
});

// POST /api/tile-options  { fieldName, value }
const createTileOption = asyncHandler(async (req, res) => {
  const { fieldName, value } = req.body;
  if (!FIELD_NAMES.includes(fieldName)) throw new ApiError(400, 'Invalid field name');

  const trimmed = (value || '').trim();
  if (!trimmed) throw new ApiError(400, 'Option value is required');

  const { data, error } = await supabase
    .from('tile_field_options')
    .insert({ field_name: fieldName, option_value: trimmed })
    .select('*')
    .single();

  if (error && error.code === '23505') {
    // Already saved for this field — return the existing row so clicking
    // Add on a duplicate value is a harmless no-op instead of an error.
    const { data: existing, error: fetchError } = await supabase
      .from('tile_field_options')
      .select('*')
      .eq('field_name', fieldName)
      .eq('option_value', trimmed)
      .maybeSingle();

    assertNoSupabaseError(fetchError, 'Failed to save option');
    return res.status(200).json({ success: true, data: existing });
  }

  assertNoSupabaseError(error, 'Failed to save option');
  res.status(201).json({ success: true, data });
});

// DELETE /api/tile-options/:id  -- instant, no confirmation required
const deleteTileOption = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('tile_field_options')
    .delete()
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to delete option');
  if (!data) throw new ApiError(404, 'Option not found');
  res.json({ success: true, message: 'Option deleted' });
});

module.exports = { getTileOptions, createTileOption, deleteTileOption };
