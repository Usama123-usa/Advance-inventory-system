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
  P0005: () => new ApiError(404, 'Pending payment record not found'),
  P0006: () => new ApiError(400, 'Payment amount must be greater than zero'),
  P0007: () => new ApiError(400, 'Payment amount cannot exceed the outstanding balance'),
  P0008: () => new ApiError(404, 'Sale not found'),
  P0009: () => new ApiError(400, 'Every item needs a valid selling price'),
  P0010: () => new ApiError(400, 'Customer name and phone are required when the sale is not fully paid'),
  P0011: () => new ApiError(400, 'This invoice number already exists. Please enter a different invoice number.'),
  P0012: () => new ApiError(400, 'Invoice number is required'),
  P0013: (message) => {
    const [, productName] = message.split('RETURN_EXCEEDS_SOLD: ');
    return new ApiError(400, productName ? `Cannot return more than the sold quantity for "${productName}"` : 'Cannot return more than the sold quantity');
  },
  P0014: () => new ApiError(404, 'This item was not found on the selected invoice'),
};

// Throws a mapped ApiError if `error` (from a supabase-js call) is set.
function assertNoSupabaseError(error, fallbackMessage = 'Database operation failed') {
  if (!error) return;

  const mapper = RPC_ERROR_MAP[error.code];
  if (mapper) throw mapper(error.message);

  // Fallback safety net for the rare race where two requests both pass the
  // RPC's explicit duplicate check at the same time and hit the unique
  // index instead — same friendly message as the P0011 path above.
  if (error.code === '23505' && error.message?.includes('invoice_number')) {
    throw new ApiError(400, 'This invoice number already exists. Please enter a different invoice number.');
  }
  if (error.code === '23505') throw new ApiError(400, 'A record with these details already exists.');
  if (error.code === '23503') throw new ApiError(400, 'This action references a record that no longer exists.');
  if (error.code === '23502') throw new ApiError(400, 'A required field is missing.');
  if (error.code === 'PGRST116') throw new ApiError(404, 'Record not found');

  console.error('[supabase]', error);
  throw new ApiError(500, fallbackMessage);
}

module.exports = { assertNoSupabaseError };
