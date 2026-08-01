const { supabase } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { assertNoSupabaseError } = require('../utils/supabaseErrors');

const formatSummaryRow = (row) => ({
  totalProducts: row.total_products,
  totalCategories: row.total_categories,
  lowStockItems: row.low_stock_items,
  todaySales: { total: Number(row.today_sales_total), count: row.today_sales_count },
  monthlySales: { total: Number(row.monthly_sales_total), count: row.monthly_sales_count },
  totalRevenue: Number(row.total_revenue),
  todayExpenses: Number(row.today_expenses),
  monthlyExpenses: Number(row.monthly_expenses),
});

const formatRecentSales = (rows) =>
  rows.map(({ customers, ...rest }) => ({
    ...rest,
    customer_name: customers?.name || 'Walk-in Customer',
  }));

// GET /api/dashboard  -- everything the Dashboard page needs in one round
// trip (summary, recent sales, best sellers, sales trend), run in parallel
// on the backend instead of the frontend firing 4 separate requests.
const getDashboard = asyncHandler(async (req, res) => {
  const { days = 14, recentLimit = 6, bestSellingLimit = 5 } = req.query;

  const [summaryResult, recentSalesResult, bestSellingResult, salesTrendResult] = await Promise.all([
    supabase.rpc('get_store_dashboard', { p_store_id: req.storeId }),
    supabase
      .from('sales')
      .select('id, invoice_number, grand_total, payment_method, created_at, customers(name)')
      .eq('store_id', req.storeId)
      .order('created_at', { ascending: false })
      .limit(Number(recentLimit)),
    supabase.rpc('get_best_selling', { p_store_id: req.storeId, p_limit: Number(bestSellingLimit) }),
    supabase.rpc('get_sales_trend', { p_store_id: req.storeId, p_days: Number(days) }),
  ]);

  assertNoSupabaseError(summaryResult.error, 'Failed to load dashboard summary');
  assertNoSupabaseError(recentSalesResult.error, 'Failed to load recent sales');
  assertNoSupabaseError(bestSellingResult.error, 'Failed to load best selling products');
  assertNoSupabaseError(salesTrendResult.error, 'Failed to load sales trend');

  res.json({
    success: true,
    data: {
      summary: formatSummaryRow(summaryResult.data[0]),
      recentSales: formatRecentSales(recentSalesResult.data),
      bestSelling: bestSellingResult.data,
      salesTrend: salesTrendResult.data,
    },
  });
});

// GET /api/dashboard/summary  (kept for any direct/legacy callers)
const getSummary = asyncHandler(async (req, res) => {
  const { data, error } = await supabase.rpc('get_store_dashboard', { p_store_id: req.storeId });
  assertNoSupabaseError(error, 'Failed to load dashboard summary');
  res.json({ success: true, data: formatSummaryRow(data[0]) });
});

// GET /api/dashboard/recent-sales?limit=
const getRecentSales = asyncHandler(async (req, res) => {
  const { limit = 8 } = req.query;
  const { data, error } = await supabase
    .from('sales')
    .select('id, invoice_number, grand_total, payment_method, created_at, customers(name)')
    .eq('store_id', req.storeId)
    .order('created_at', { ascending: false })
    .limit(Number(limit));

  assertNoSupabaseError(error, 'Failed to load recent sales');
  res.json({ success: true, data: formatRecentSales(data) });
});

// GET /api/dashboard/best-selling?limit=
const getBestSelling = asyncHandler(async (req, res) => {
  const { limit = 5 } = req.query;
  const { data, error } = await supabase.rpc('get_best_selling', { p_store_id: req.storeId, p_limit: Number(limit) });
  assertNoSupabaseError(error, 'Failed to load best selling products');
  res.json({ success: true, data });
});

// GET /api/dashboard/sales-trend?days=
const getSalesTrend = asyncHandler(async (req, res) => {
  const { days = 14 } = req.query;
  const { data, error } = await supabase.rpc('get_sales_trend', { p_store_id: req.storeId, p_days: Number(days) });
  assertNoSupabaseError(error, 'Failed to load sales trend');
  res.json({ success: true, data });
});

module.exports = { getDashboard, getSummary, getRecentSales, getBestSelling, getSalesTrend };
