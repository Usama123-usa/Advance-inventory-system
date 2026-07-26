const { supabase } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { assertNoSupabaseError } = require('../utils/supabaseErrors');

const flatten = (row, relation, key) => {
  if (!row) return row;
  const { [relation]: related, ...rest } = row;
  return { ...rest, [key]: related?.name || null };
};

// GET /api/inventory/current?search=&page=&limit=
const getCurrentStock = asyncHandler(async (req, res) => {
  const { search = '', page = 1, limit = 20 } = req.query;
  const from = (Number(page) - 1) * Number(limit);
  const to = from + Number(limit) - 1;

  let queryBuilder = supabase
    .from('products')
    .select('id, name, sku, barcode, quantity, unit, low_stock_threshold, is_low_stock, categories(name)', { count: 'exact' })
    .order('name', { ascending: true })
    .range(from, to);

  if (search) {
    queryBuilder = queryBuilder.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
  }

  const { data, error, count } = await queryBuilder;
  assertNoSupabaseError(error, 'Failed to load stock levels');

  res.json({
    success: true,
    data: data.map((row) => flatten(row, 'categories', 'category_name')),
    pagination: {
      total: count || 0,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil((count || 0) / Number(limit)),
    },
  });
});

// GET /api/inventory/low-stock
const getLowStock = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, sku, quantity, low_stock_threshold, unit, categories(name)')
    .eq('is_low_stock', true)
    .eq('status', 'active')
    .order('quantity', { ascending: true });

  assertNoSupabaseError(error, 'Failed to load low stock items');
  res.json({ success: true, data: data.map((row) => flatten(row, 'categories', 'category_name')) });
});

// GET /api/inventory/history?productId=&page=&limit=
const getHistory = asyncHandler(async (req, res) => {
  const { productId = '', page = 1, limit = 30 } = req.query;
  const from = (Number(page) - 1) * Number(limit);
  const to = from + Number(limit) - 1;

  let queryBuilder = supabase
    .from('inventory_logs')
    .select('*, products(name), users(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (productId) queryBuilder = queryBuilder.eq('product_id', productId);

  const { data, error, count } = await queryBuilder;
  assertNoSupabaseError(error, 'Failed to load inventory history');

  const rows = data.map((row) => {
    const { products, users, ...rest } = row;
    return { ...rest, product_name: products?.name || null, created_by_name: users?.name || null };
  });

  res.json({
    success: true,
    data: rows,
    pagination: {
      total: count || 0,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil((count || 0) / Number(limit)),
    },
  });
});

// POST /api/inventory/stock-in  { productId, quantity, reason }
const stockIn = asyncHandler(async (req, res) => {
  const { productId, quantity, reason } = req.body;
  const qty = Number(quantity);
  if (!qty || qty <= 0) throw new ApiError(400, 'Quantity must be a positive number');

  const result = await adjustStock({ productId, delta: qty, changeType: 'in', reason: reason || 'Stock added', userId: req.user.id });
  res.json({ success: true, data: result });
});

// POST /api/inventory/stock-out { productId, quantity, reason }
const stockOut = asyncHandler(async (req, res) => {
  const { productId, quantity, reason } = req.body;
  const qty = Number(quantity);
  if (!qty || qty <= 0) throw new ApiError(400, 'Quantity must be a positive number');

  const result = await adjustStock({ productId, delta: -qty, changeType: 'out', reason: reason || 'Stock removed', userId: req.user.id });
  res.json({ success: true, data: result });
});

// Atomic stock adjustment via the adjust_stock() Postgres function (row-locks
// the product, validates bounds, updates quantity, and logs it in one transaction).
async function adjustStock({ productId, delta, changeType, reason, userId, referenceId = null }) {
  const { data, error } = await supabase.rpc('adjust_stock', {
    p_product_id: productId,
    p_delta: delta,
    p_change_type: changeType,
    p_reason: reason,
    p_user_id: userId,
    p_reference_id: referenceId,
  });

  assertNoSupabaseError(error, 'Failed to adjust stock');
  return data;
}

module.exports = { getCurrentStock, getLowStock, getHistory, stockIn, stockOut, adjustStock };
