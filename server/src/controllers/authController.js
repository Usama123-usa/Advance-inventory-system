const bcrypt = require('bcryptjs');
const { supabase } = require('../config/supabase');
const { signToken } = require('../utils/jwt');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 10;

const sanitizeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
});

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const { data: user, error } = await supabase
    .from('users')
    .select('id, name, email, password_hash, role, is_active')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (error) throw new ApiError(500, 'Failed to look up user');
  if (!user || !user.is_active) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const token = signToken({ sub: user.id, role: user.role });

  res.json({
    success: true,
    data: { user: sanitizeUser(user), token },
  });
});

// POST /api/auth/register  (creates additional staff/admin accounts; admin-only in routes)
const register = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;
  const normalizedEmail = email.toLowerCase().trim();

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existing) {
    throw new ApiError(409, 'A user with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const { data: user, error } = await supabase
    .from('users')
    .insert({ name: name.trim(), email: normalizedEmail, password_hash: passwordHash, role: role || 'staff' })
    .select('id, name, email, role')
    .single();

  if (error) throw new ApiError(500, 'Failed to create user');

  res.status(201).json({ success: true, data: { user } });
});

// GET /api/auth/me
const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: sanitizeUser(req.user) } });
});

// POST /api/auth/logout  (stateless JWT: client just discards the token)
const logout = asyncHandler(async (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

// PATCH /api/auth/change-password
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const { data: user, error } = await supabase
    .from('users')
    .select('password_hash')
    .eq('id', req.user.id)
    .single();

  if (error) throw new ApiError(500, 'Failed to look up user');

  const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
  if (!isMatch) {
    throw new ApiError(401, 'Current password is incorrect');
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  const { error: updateError } = await supabase
    .from('users')
    .update({ password_hash: passwordHash })
    .eq('id', req.user.id);

  if (updateError) throw new ApiError(500, 'Failed to update password');

  res.json({ success: true, message: 'Password updated successfully' });
});

module.exports = { login, register, me, logout, changePassword };
