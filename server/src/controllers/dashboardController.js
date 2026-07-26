const { supabase } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { assertNoSupabaseError } = require('../utils/supabaseErrors');

// GET /api/dashboard/summary
const getSummary = asyncHandler(async (req, res) => {
  const { data, error } = await supabase.rpc('get_dashboard_summary');
  assertNoSupabaseError(error, 'Failed to load dashboard summary');

  // returns table(...) always comes back as an array, even for one row.
  const row = data[0];

  res.json({
    success: true,
    data: {
      totalProducts: row.total_products,
      totalCategories: row.total_categories,
      lowStockItems: row.low_stock_items,
      todaySales: { total: Number(row.today_sales_total), count: row.today_sales_count },
      monthlySales: { total: Number(row.monthly_sales_total), count: row.monthly_sales_count },
      totalRevenue: Number(row.total_revenue),
    },
  });
});

// GET /api/dashboard/recent-sales?limit=
const getRecentSales = asyncHandler(async (req, res) => {
  const { limit = 8 } = req.query;
  const { data, error } = await supabase
    .from('sales')
    .select('id, invoice_number, grand_total, payment_method, created_at, customers(name)')
    .order('created_at', { ascending: false })
    .limit(Number(limit));

  assertNoSupabaseError(error, 'Failed to load recent sales');

  const rows = data.map(({ customers, ...rest }) => ({
    ...rest,
    customer_name: customers?.name || 'Walk-in Customer',
  }));

  res.json({ success: true, data: rows });
});

// GET /api/dashboard/best-selling?limit=
const getBestSelling = asyncHandler(async (req, res) => {
  const { limit = 5 } = req.query;
  const { data, error } = await supabase.rpc('get_best_selling', { p_limit: Number(limit) });
  assertNoSupabaseError(error, 'Failed to load best selling products');
  res.json({ success: true, data });
});

// GET /api/dashboard/sales-trend?days=
const getSalesTrend = asyncHandler(async (req, res) => {
  const { days = 14 } = req.query;
  const { data, error } = await supabase.rpc('get_sales_trend', { p_days: Number(days) });
  assertNoSupabaseError(error, 'Failed to load sales trend');
  res.json({ success: true, data });
});

module.exports = { getSummary, getRecentSales, getBestSelling, getSalesTrend };
