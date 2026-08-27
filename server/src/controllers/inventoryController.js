const { supabase } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { assertNoSupabaseError } = require('../utils/supabaseErrors');

const flattenStockRow = (row) => {
  const { categories, store_products, ...rest } = row;
  const sp = Array.isArray(store_products) ? store_products[0] : store_products;
  return {
    ...rest,
    category_name: categories?.name || null,
    quantity: sp?.stock ?? 0,
    low_stock_threshold: sp?.low_stock_threshold ?? 0,
    is_low_stock: sp?.is_low_stock ?? false,
  };
};

// GET /api/inventory/current?search=&page=&limit=
const getCurrentStock = asyncHandler(async (req, res) => {
  const { search = '', page = 1, limit = 20 } = req.query;
  const from = (Number(page) - 1) * Number(limit);
  const to = from + Number(limit) - 1;

  let queryBuilder = supabase
    .from('products')
    .select('id, name, sku, barcode, unit, categories(name), store_products!inner(stock, low_stock_threshold, is_low_stock)', {
      count: 'exact',
    })
    .eq('store_products.store_id', req.storeId)
    .order('name', { ascending: true })
    .range(from, to);

  if (search) {
    queryBuilder = queryBuilder.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
  }

  const { data, error, count } = await queryBuilder;
  assertNoSupabaseError(error, 'Failed to load stock levels');

  res.json({
    success: true,
    data: data.map(flattenStockRow),
    pagination: {
      total: count || 0,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil((count || 0) / Number(limit)),
    },
  });
});

// GET /api/inventory/low-stock?page=&limit=
const getLowStock = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const from = (Number(page) - 1) * Number(limit);
  const to = from + Number(limit) - 1;

  const { data, error, count } = await supabase
    .from('products')
    .select('id, name, sku, unit, categories(name), store_products!inner(stock, low_stock_threshold, is_low_stock)', {
      count: 'exact',
    })
    .eq('store_products.store_id', req.storeId)
    .eq('store_products.is_low_stock', true)
    .eq('status', 'active')
    .order('name', { ascending: true })
    .range(from, to);

  assertNoSupabaseError(error, 'Failed to load low stock items');

  res.json({
    success: true,
    data: data.map(flattenStockRow),
    pagination: {
      total: count || 0,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil((count || 0) / Number(limit)),
    },
  });
});

// GET /api/inventory/history?productId=&page=&limit=
const getHistory = asyncHandler(async (req, res) => {
  const { productId = '', page = 1, limit = 30 } = req.query;
  const from = (Number(page) - 1) * Number(limit);
  const to = from + Number(limit) - 1;

  let queryBuilder = supabase
    .from('inventory_logs')
    .select('id, change_type, quantity, previous_quantity, new_quantity, reason, created_at, products(name), users(name)', {
      count: 'exact',
    })
    .eq('store_id', req.storeId)
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

  const result = await adjustStock({
    storeId: req.storeId,
    productId,
    delta: qty,
    changeType: 'in',
    reason: reason || 'Stock added',
    userId: req.user.id,
  });
  res.json({ success: true, data: result });
});

// POST /api/inventory/stock-out { productId, quantity, reason }
const stockOut = asyncHandler(async (req, res) => {
  const { productId, quantity, reason } = req.body;
  const qty = Number(quantity);
  if (!qty || qty <= 0) throw new ApiError(400, 'Quantity must be a positive number');

  const result = await adjustStock({
    storeId: req.storeId,
    productId,
    delta: -qty,
    changeType: 'out',
    reason: reason || 'Stock removed',
    userId: req.user.id,
  });
  res.json({ success: true, data: result });
});

// Atomic stock adjustment via the adjust_stock() Postgres function (row-locks
// the store_products row, validates bounds, updates stock, and logs it in
// one transaction).
async function adjustStock({ storeId, productId, delta, changeType, reason, userId, referenceId = null }) {
  const { data, error } = await supabase.rpc('adjust_stock', {
    p_store_id: storeId,
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

// GET /api/inventory/stock-returns?page=&limit=
const getStockReturns = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const from = (Number(page) - 1) * Number(limit);
  const to = from + Number(limit) - 1;

  const { data, error, count } = await supabase
    .from('stock_returns')
    .select('id, reason, created_at, users(name), stock_return_items(product_name, quantity, unit, products(name))', { count: 'exact' })
    .eq('store_id', req.storeId)
    .order('created_at', { ascending: false })
    .range(from, to);

  assertNoSupabaseError(error, 'Failed to load stock returns');

  const rows = data.map((row) => {
    const { users, stock_return_items, ...rest } = row;
    return {
      ...rest,
      created_by_name: users?.name || null,
      items: (stock_return_items || []).map((item) => ({
        quantity: item.quantity,
        unit: item.unit,
        // Prefer the live product name; fall back to the denormalized
        // snapshot for products that have since been permanently deleted
        // (stock_return_items.product_id is ON DELETE SET NULL).
        product_name: item.products?.name || item.product_name || null,
      })),
    };
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

// POST /api/inventory/stock-return  { reason, items: [{ productId, quantity }] }
const createStockReturn = asyncHandler(async (req, res) => {
  const { reason, items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'Select at least one product to return');
  }

  const normalizedItems = items.map((item) => ({
    productId: item.productId,
    quantity: Number(item.quantity),
  }));

  if (normalizedItems.some((item) => !item.productId || !item.quantity || item.quantity <= 0)) {
    throw new ApiError(400, 'Every returned product needs a valid quantity greater than 0');
  }

  const { data, error } = await supabase.rpc('create_stock_return', {
    p_store_id: req.storeId,
    p_reason: reason || null,
    p_items: normalizedItems,
    p_user_id: req.user.id,
  });

  assertNoSupabaseError(error, 'Failed to save stock return');
  res.status(201).json({ success: true, data: { id: data } });
});

module.exports = {
  getCurrentStock,
  getLowStock,
  getHistory,
  stockIn,
  stockOut,
  adjustStock,
  getStockReturns,
  createStockReturn,
};
