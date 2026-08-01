const { supabase } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { assertNoSupabaseError } = require('../utils/supabaseErrors');

// GET /api/reports/sales?period=daily|weekly|monthly&from=&to=
const getSalesReport = asyncHandler(async (req, res) => {
  const { period = 'daily', from = null, to = null } = req.query;

  const { data, error } = await supabase.rpc('get_sales_report', {
    p_store_id: req.storeId,
    p_period: period,
    p_from: from,
    p_to: to,
  });

  assertNoSupabaseError(error, 'Failed to load sales report');
  res.json({ success: true, data });
});

// GET /api/reports/top-products?limit=&from=&to=
const getTopProducts = asyncHandler(async (req, res) => {
  const { limit = 10, from = null, to = null } = req.query;

  const { data, error } = await supabase.rpc('get_top_products', {
    p_store_id: req.storeId,
    p_limit: Number(limit),
    p_from: from,
    p_to: to,
  });

  assertNoSupabaseError(error, 'Failed to load top products');
  res.json({ success: true, data });
});

// GET /api/reports/stock
const getStockReport = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select(
      'name, sku, barcode, unit, purchase_price, selling_price, categories(name), store_products!inner(stock, low_stock_threshold, is_low_stock)'
    )
    .eq('store_products.store_id', req.storeId)
    .order('name', { ascending: true });

  assertNoSupabaseError(error, 'Failed to load stock report');

  const rows = data.map(({ categories, store_products, purchase_price, ...rest }) => {
    const sp = Array.isArray(store_products) ? store_products[0] : store_products;
    const quantity = sp?.stock ?? 0;
    return {
      ...rest,
      purchase_price,
      category_name: categories?.name || null,
      quantity,
      is_low_stock: sp?.is_low_stock ?? false,
      stock_value: Number((quantity * purchase_price).toFixed(2)),
    };
  });

  const totalStockValue = rows.reduce((sum, r) => sum + r.stock_value, 0);
  res.json({ success: true, data: rows, meta: { totalStockValue } });
});

// GET /api/reports/profit?from=&to=
const getProfitReport = asyncHandler(async (req, res) => {
  const { from = null, to = null } = req.query;

  const { data, error } = await supabase.rpc('get_profit_report', { p_store_id: req.storeId, p_from: from, p_to: to });
  assertNoSupabaseError(error, 'Failed to load profit report');

  const totals = data.reduce(
    (acc, r) => ({
      revenue: acc.revenue + Number(r.revenue),
      cost: acc.cost + Number(r.cost),
      profit: acc.profit + Number(r.profit),
    }),
    { revenue: 0, cost: 0, profit: 0 }
  );

  res.json({ success: true, data, meta: totals });
});

// GET /api/reports/all-stores?from=&to=  (admin only — combined view across
// every active store: total sales, expenses, and net profit per store)
const getAllStoresReport = asyncHandler(async (req, res) => {
  const { from = null, to = null } = req.query;

  const { data, error } = await supabase.rpc('get_all_stores_report', {
    p_admin_user_id: req.user.id,
    p_from: from,
    p_to: to,
  });

  assertNoSupabaseError(error, 'Failed to load all-stores report');

  const totals = data.reduce(
    (acc, r) => ({
      totalSales: acc.totalSales + Number(r.total_sales),
      totalOrders: acc.totalOrders + Number(r.total_orders),
      totalExpenses: acc.totalExpenses + Number(r.total_expenses),
      netProfit: acc.netProfit + Number(r.net_profit),
    }),
    { totalSales: 0, totalOrders: 0, totalExpenses: 0, netProfit: 0 }
  );

  res.json({ success: true, data, meta: totals });
});

module.exports = { getSalesReport, getTopProducts, getStockReport, getProfitReport, getAllStoresReport };
