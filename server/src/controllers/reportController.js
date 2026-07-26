const { supabase } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { assertNoSupabaseError } = require('../utils/supabaseErrors');

// GET /api/reports/sales?period=daily|weekly|monthly&from=&to=
const getSalesReport = asyncHandler(async (req, res) => {
  const { period = 'daily', from = null, to = null } = req.query;

  const { data, error } = await supabase.rpc('get_sales_report', {
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
    .select('name, sku, barcode, quantity, unit, purchase_price, selling_price, is_low_stock, categories(name)')
    .order('name', { ascending: true });

  assertNoSupabaseError(error, 'Failed to load stock report');

  const rows = data.map(({ categories, purchase_price, ...rest }) => ({
    ...rest,
    purchase_price,
    category_name: categories?.name || null,
    stock_value: Number((rest.quantity * purchase_price).toFixed(2)),
  }));

  const totalStockValue = rows.reduce((sum, r) => sum + r.stock_value, 0);
  res.json({ success: true, data: rows, meta: { totalStockValue } });
});

// GET /api/reports/profit?from=&to=
const getProfitReport = asyncHandler(async (req, res) => {
  const { from = null, to = null } = req.query;

  const { data, error } = await supabase.rpc('get_profit_report', { p_from: from, p_to: to });
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

module.exports = { getSalesReport, getTopProducts, getStockReport, getProfitReport };
