const ApiError = require('./ApiError');

// Postgres error codes raised by our RPC functions (sql/schema.sql) mapped to
// friendly HTTP errors. Anything else is treated as an unexpected 500.
const RPC_ERROR_MAP = {
  P0001: (message) => {
    const [, productName] = message.split('INSUFFICIENT_STOCK: ');
    return new ApiError(400, productName ? `Insufficient stock for "${productName}"` : 'Insufficient stock for this operation');
  },
  P0002: () => new ApiError(404, 'Product not found'),
  P0003: () => new ApiError(400, 'At least one item is required to complete a sale'),
  P0004: () => new ApiError(400, 'Each item must have a positive quantity'),
};

// Throws a mapped ApiError if `error` (from a supabase-js call) is set.
function assertNoSupabaseError(error, fallbackMessage = 'Database operation failed') {
  if (!error) return;

  const mapper = RPC_ERROR_MAP[error.code];
  if (mapper) throw mapper(error.message);

  if (error.code === '23505') throw new ApiError(400, 'A record with these details already exists.');
  if (error.code === '23503') throw new ApiError(400, 'This action references a record that no longer exists.');
  if (error.code === '23502') throw new ApiError(400, 'A required field is missing.');
  if (error.code === 'PGRST116') throw new ApiError(404, 'Record not found');

  console.error('[supabase]', error);
  throw new ApiError(500, fallbackMessage);
}

module.exports = { assertNoSupabaseError };
