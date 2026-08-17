const bcrypt = require('bcryptjs');
const { supabase } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { assertNoSupabaseError } = require('../utils/supabaseErrors');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 10;

const USER_SELECT = 'id, name, email, role, is_active, store_id, created_at, updated_at, stores!store_id(name)';

const flattenUser = (user) => {
  if (!user) return user;
  const { stores, ...rest } = user;
  return { ...rest, store_name: stores?.name || null };
};

// GET /api/users  (admin only)
const getUsers = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select(USER_SELECT)
    .order('created_at', { ascending: false });

  assertNoSupabaseError(error, 'Failed to load users');
  res.json({ success: true, data: data.map(flattenUser) });
});

// POST /api/users  (admin only)
// body: { name, email, password, role, storeId }
const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role, storeId } = req.body;
  const normalizedEmail = email.toLowerCase().trim();
  const normalizedRole = ['admin', 'staff', 'store_manager'].includes(role) ? role : 'staff';

  if (normalizedRole !== 'admin' && !storeId) {
    throw new ApiError(400, 'A store must be selected for staff and store manager accounts');
  }

  const { data: existing } = await supabase.from('users').select('id').eq('email', normalizedEmail).maybeSingle();
  if (existing) throw new ApiError(409, 'A user with this email already exists');

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const { data, error } = await supabase
    .from('users')
    .insert({
      name: name.trim(),
      email: normalizedEmail,
      password_hash: passwordHash,
      role: normalizedRole,
      store_id: normalizedRole === 'admin' ? null : storeId,
    })
    .select(USER_SELECT)
    .single();

  assertNoSupabaseError(error, 'Failed to create user');
  res.status(201).json({ success: true, data: flattenUser(data) });
});

// PUT /api/users/:id  (admin only)
// body: { name, email, role, storeId, isActive }
const updateUser = asyncHandler(async (req, res) => {
  const { name, email, role, storeId, isActive } = req.body;

  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (email !== undefined) updates.email = email.toLowerCase().trim();
  if (isActive !== undefined) updates.is_active = !!isActive;

  if (role !== undefined) {
    const normalizedRole = ['admin', 'staff', 'store_manager'].includes(role) ? role : 'staff';
    if (normalizedRole !== 'admin' && !storeId) {
      throw new ApiError(400, 'A store must be selected for staff and store manager accounts');
    }
    updates.role = normalizedRole;
    updates.store_id = normalizedRole === 'admin' ? null : storeId;
  } else if (storeId !== undefined) {
    updates.store_id = storeId || null;
  }

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', req.params.id)
    .select(USER_SELECT)
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to update user');
  if (!data) throw new ApiError(404, 'User not found');
  res.json({ success: true, data: flattenUser(data) });
});

// PATCH /api/users/:id/reset-password  (admin only)
// body: { newPassword }
// Overwrites the password hash directly — there is no path that reads or
// returns the existing hash, so a plaintext password is never exposed.
const resetPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body;

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  const { data, error } = await supabase
    .from('users')
    .update({ password_hash: passwordHash })
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to reset password');
  if (!data) throw new ApiError(404, 'User not found');
  res.json({ success: true, message: 'Password reset successfully' });
});

// DELETE /api/users/:id  (admin only)
const deleteUser = asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) {
    throw new ApiError(400, 'You cannot delete your own account');
  }

  const { data, error } = await supabase.from('users').delete().eq('id', req.params.id).select('id').maybeSingle();
  assertNoSupabaseError(error, 'Failed to delete user');
  if (!data) throw new ApiError(404, 'User not found');
  res.json({ success: true, message: 'User deleted successfully' });
});

module.exports = { getUsers, createUser, updateUser, resetPassword, deleteUser };
