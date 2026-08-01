const { verifyToken } = require('../utils/jwt');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { supabase } = require('../config/supabase');

// Verifies the JWT and attaches the authenticated user to req.user.
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new ApiError(401, 'Authentication required');
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    throw new ApiError(401, 'Invalid or expired token');
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, name, email, role, is_active, store_id')
    .eq('id', decoded.sub)
    .maybeSingle();

  if (error) throw new ApiError(500, 'Failed to verify user session');
  if (!user || !user.is_active) {
    throw new ApiError(401, 'Account not found or deactivated');
  }

  req.user = user;
  next();
});

// Restricts a route to specific roles, e.g. requireRole('admin')
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new ApiError(403, 'You do not have permission to perform this action'));
  }
  next();
};

// Resolves req.storeId — the store a request should be scoped to.
// Non-admins are ALWAYS locked to their own store_id, regardless of what
// the client sends (data isolation must not depend on trusting the client).
// Admins may switch stores via ?storeId=, validated against the stores
// table; they default to the Main Store when no valid storeId is supplied.
const resolveStore = asyncHandler(async (req, res, next) => {
  if (req.user.role !== 'admin') {
    if (!req.user.store_id) {
      throw new ApiError(403, 'Your account is not assigned to a store');
    }
    req.storeId = req.user.store_id;
    return next();
  }

  const requestedStoreId = req.query.storeId;

  if (requestedStoreId) {
    const { data: store, error } = await supabase
      .from('stores')
      .select('id')
      .eq('id', requestedStoreId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw new ApiError(500, 'Failed to verify store');
    if (!store) throw new ApiError(404, 'Store not found');

    req.storeId = store.id;
    return next();
  }

  const { data: mainStore, error: mainError } = await supabase
    .from('stores')
    .select('id')
    .eq('is_main', true)
    .maybeSingle();

  if (mainError) throw new ApiError(500, 'Failed to resolve Main Store');
  if (!mainStore) throw new ApiError(500, 'Main Store is not configured');

  req.storeId = mainStore.id;
  next();
});

module.exports = { authenticate, requireRole, resolveStore };
