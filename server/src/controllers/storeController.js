const bcrypt = require('bcryptjs');
const { supabase } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { assertNoSupabaseError } = require('../utils/supabaseErrors');
const cache = require('../utils/cache');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 10;

// GET /api/stores  (admin only)
const getStores = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('stores')
    .select('id, name, is_main, is_active, created_at')
    .order('is_main', { ascending: false })
    .order('name', { ascending: true });

  assertNoSupabaseError(error, 'Failed to load stores');
  res.json({ success: true, data });
});

// GET /api/stores/:id  (admin only)
const getStoreById = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('stores')
    .select('id, name, is_main, is_active, created_at')
    .eq('id', req.params.id)
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to load store');
  if (!data) throw new ApiError(404, 'Store not found');
  res.json({ success: true, data });
});

// POST /api/stores  { name, managerEmail, managerPassword, importProducts }
// Atomically creates the store + its manager user via create_sub_store(),
// optionally importing the existing product catalog at zero stock.
const createStore = asyncHandler(async (req, res) => {
  const { name, managerEmail, managerPassword, importProducts = false } = req.body;

  const passwordHash = await bcrypt.hash(managerPassword, BCRYPT_ROUNDS);

  const { data, error } = await supabase.rpc('create_sub_store', {
    p_name: name.trim(),
    p_manager_email: managerEmail.toLowerCase().trim(),
    p_manager_password_hash: passwordHash,
    p_created_by: req.user.id,
    p_import_products: Boolean(importProducts),
  });

  assertNoSupabaseError(error, 'Failed to create store');
  res.status(201).json({ success: true, data });
});

// PUT /api/stores/:id  { name, isActive }
const updateStore = asyncHandler(async (req, res) => {
  const { data: existing, error: fetchError } = await supabase
    .from('stores')
    .select('id, is_main')
    .eq('id', req.params.id)
    .maybeSingle();

  assertNoSupabaseError(fetchError, 'Failed to load store');
  if (!existing) throw new ApiError(404, 'Store not found');

  const updatePayload = {};
  if (req.body.name !== undefined) updatePayload.name = req.body.name.trim();
  if (req.body.isActive !== undefined) {
    if (existing.is_main && req.body.isActive === false) {
      throw new ApiError(400, 'The Main Store cannot be deactivated');
    }
    updatePayload.is_active = Boolean(req.body.isActive);
  }

  const { data, error } = await supabase
    .from('stores')
    .update(updatePayload)
    .eq('id', req.params.id)
    .select('id, name, is_main, is_active, created_at')
    .single();

  assertNoSupabaseError(error, 'Failed to update store');
  cache.del(`store:${req.params.id}`);
  cache.del('store:main');
  res.json({ success: true, data });
});

// DELETE /api/stores/:id  -- soft delete (archive); sales/expense history is
// preserved since nothing references the store with an ON DELETE CASCADE
// that would wipe it, and is_active=false simply hides it going forward.
const deleteStore = asyncHandler(async (req, res) => {
  const { data: existing, error: fetchError } = await supabase
    .from('stores')
    .select('id, is_main')
    .eq('id', req.params.id)
    .maybeSingle();

  assertNoSupabaseError(fetchError, 'Failed to load store');
  if (!existing) throw new ApiError(404, 'Store not found');
  if (existing.is_main) throw new ApiError(400, 'The Main Store cannot be deleted');

  const { error } = await supabase.from('stores').update({ is_active: false }).eq('id', req.params.id);
  assertNoSupabaseError(error, 'Failed to archive store');
  cache.del(`store:${req.params.id}`);

  res.json({ success: true, message: 'Store archived successfully' });
});

module.exports = { getStores, getStoreById, createStore, updateStore, deleteStore };
