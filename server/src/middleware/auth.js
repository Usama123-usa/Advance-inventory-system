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
    .select('id, name, email, role, is_active')
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

module.exports = { authenticate, requireRole };
