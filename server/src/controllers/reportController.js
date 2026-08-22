const { supabase } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
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

// GET /api/reports/sales-detail?from=&to=
// Full Daily/Weekly/Monthly/Custom-Range report: every sale in the window
// (with its line items), a product-wise breakdown, and a summary — all
// computed directly from sales/sale_items so historical invoices always use
// the exact price that was manually entered at sale time, never a current
// product-catalog price.
const getSalesDetailReport = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) throw new ApiError(400, 'A date range (from/to) is required');

  const { data: sales, error } = await supabase
    .from('sales')
    .select(
      'id, invoice_number, created_at, customer_name, customer_phone, payment_method, payment_status, subtotal, discount, tax, grand_total, paid_amount, remaining_balance'
    )
    .eq('store_id', req.storeId)
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: false })
    // A generous ceiling rather than the usual page-size pagination — this
    // endpoint needs every matching sale to compute an accurate total, not
    // a page of them.
    .range(0, 4999);

  assertNoSupabaseError(error, 'Failed to load sales for report');

  const saleIds = sales.map((s) => s.id);
  let items = [];
  if (saleIds.length) {
    const { data: itemRows, error: itemsError } = await supabase
      .from('sale_items')
      .select('sale_id, product_name, quantity, unit_price, total')
      .in('sale_id', saleIds);
    assertNoSupabaseError(itemsError, 'Failed to load sale items for report');
    items = itemRows;
  }

  const itemsBySale = new Map();
  for (const item of items) {
    if (!itemsBySale.has(item.sale_id)) itemsBySale.set(item.sale_id, []);
    itemsBySale.get(item.sale_id).push(item);
  }

  const salesWithItems = sales.map(({ id, ...rest }) => ({
    id,
    ...rest,
    items: itemsBySale.get(id) || [],
  }));

  // Product-wise breakdown: quantity/total summed straight from each line's
  // own stored unit_price/total, so a product sold at different manually
  // entered prices across several sales is still totalled correctly —
  // avgPrice is derived (total / quantity) for display only, never used to
  // recompute the total itself.
  const productMap = new Map();
  for (const item of items) {
    const key = item.product_name;
    if (!productMap.has(key)) productMap.set(key, { productName: key, quantity: 0, total: 0 });
    const entry = productMap.get(key);
    entry.quantity += Number(item.quantity);
    entry.total += Number(item.total);
  }
  const productBreakdown = Array.from(productMap.values())
    .map((p) => ({ ...p, avgPrice: p.quantity > 0 ? p.total / p.quantity : 0 }))
    .sort((a, b) => b.total - a.total);

  const summary = sales.reduce(
    (acc, s) => ({
      totalSales: acc.totalSales + Number(s.grand_total),
      totalPaid: acc.totalPaid + Number(s.paid_amount),
      totalPending: acc.totalPending + Number(s.remaining_balance),
    }),
    { totalSales: 0, totalPaid: 0, totalPending: 0 }
  );

  res.json({
    success: true,
    data: {
      sales: salesWithItems,
      productBreakdown,
      summary: {
        totalSales: summary.totalSales,
        totalOrders: sales.length,
        // "Items sold" = distinct products that appear in this range;
        // "quantity sold" = total units across every line item.
        totalItems: productBreakdown.length,
        totalQuantity: items.reduce((sum, i) => sum + Number(i.quantity), 0),
        totalPaid: summary.totalPaid,
        totalPending: summary.totalPending,
      },
    },
  });
});

// GET /api/reports/profit-detail?from=&to=
// Profit Report detail for any Daily/Weekly/Monthly/Custom Range window:
// every product sold in the window with its units/sales-amount/cost/profit,
// every invoice in the window (for the Invoices table — same columns as the
// Sales Report tab's), and the window's summary totals (invoices, units,
// sales, profit). Cost-of-goods-sold uses the same
// quantity * products.purchase_price convention as get_profit_report() (see
// sql/schema.sql) so "Total Sales - Total Cost = Total Profit" here matches
// what get_profit_report() would compute for the same window — this is a
// per-product breakdown of the exact same numbers, not a different metric.
const getProfitDetailReport = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) throw new ApiError(400, 'A date range (from/to) is required');

  const { data: sales, error } = await supabase
    .from('sales')
    .select('id, invoice_number, created_at, customer_name, payment_method, payment_status, grand_total')
    .eq('store_id', req.storeId)
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: false })
    .range(0, 4999);

  assertNoSupabaseError(error, 'Failed to load sales for report');

  const saleIds = sales.map((s) => s.id);
  let items = [];
  if (saleIds.length) {
    const { data: itemRows, error: itemsError } = await supabase
      .from('sale_items')
      .select('product_id, product_name, quantity, total')
      .in('sale_id', saleIds);
    assertNoSupabaseError(itemsError, 'Failed to load sale items for report');
    items = itemRows;
  }

  const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))];
  let purchasePriceByProduct = new Map();
  if (productIds.length) {
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, purchase_price')
      .in('id', productIds);
    assertNoSupabaseError(productsError, 'Failed to load product costs for report');
    purchasePriceByProduct = new Map(products.map((p) => [p.id, Number(p.purchase_price) || 0]));
  }

  const productMap = new Map();
  for (const item of items) {
    const key = item.product_id || item.product_name;
    if (!productMap.has(key)) {
      productMap.set(key, { productName: item.product_name, unitsSold: 0, salesAmount: 0, cost: 0 });
    }
    const entry = productMap.get(key);
    const purchasePrice = item.product_id ? purchasePriceByProduct.get(item.product_id) || 0 : 0;
    entry.unitsSold += Number(item.quantity);
    entry.salesAmount += Number(item.total);
    entry.cost += Number(item.quantity) * purchasePrice;
  }

  const products = Array.from(productMap.values())
    .map((p) => ({ ...p, profit: p.salesAmount - p.cost }))
    .sort((a, b) => b.salesAmount - a.salesAmount);

  const totals = products.reduce(
    (acc, p) => ({
      totalUnits: acc.totalUnits + p.unitsSold,
      totalSales: acc.totalSales + p.salesAmount,
      totalCost: acc.totalCost + p.cost,
      totalProfit: acc.totalProfit + p.profit,
    }),
    { totalUnits: 0, totalSales: 0, totalCost: 0, totalProfit: 0 }
  );

  res.json({
    success: true,
    data: {
      products,
      sales,
      summary: {
        totalInvoices: sales.length,
        totalUnits: totals.totalUnits,
        totalSales: totals.totalSales,
        totalCost: totals.totalCost,
        totalProfit: totals.totalProfit,
      },
    },
  });
});

// GET /api/reports/expenses — every expense recorded for the current store,
// with its category breakdown (same data the Expenses page already shows),
// plus a total for the whole list.
const getExpenseReport = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('expenses')
    .select('id, date, description, amount, users(name), expense_category_links(amount, expense_categories(id, name))')
    .eq('store_id', req.storeId)
    .order('date', { ascending: false })
    .range(0, 4999);

  assertNoSupabaseError(error, 'Failed to load expense report');

  const rows = data.map((row) => {
    const { users, expense_category_links, ...rest } = row;
    return {
      ...rest,
      created_by_name: users?.name || null,
      categories: (expense_category_links || [])
        .filter((link) => link.expense_categories)
        .map((link) => ({ ...link.expense_categories, amount: Number(link.amount) })),
    };
  });

  const totalExpenses = rows.reduce((sum, r) => sum + Number(r.amount), 0);
  res.json({ success: true, data: rows, meta: { totalExpenses, totalEntries: rows.length } });
});

// GET /api/reports/pending-payments — every invoice for the current store
// with an outstanding balance (partial/unpaid), read straight from
// sales/sale data (distinct from the customer_balances ledger the dedicated
// Pending Payments page uses).
const getPendingPaymentReport = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('sales')
    .select(
      'id, invoice_number, created_at, customer_name, customer_phone, payment_method, payment_status, grand_total, paid_amount, remaining_balance'
    )
    .eq('store_id', req.storeId)
    .gt('remaining_balance', 0)
    .order('created_at', { ascending: false })
    .range(0, 4999);

  assertNoSupabaseError(error, 'Failed to load pending payment report');

  const totalPending = data.reduce((sum, r) => sum + Number(r.remaining_balance), 0);
  res.json({ success: true, data, meta: { totalPending, totalInvoices: data.length } });
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

module.exports = {
  getSalesReport,
  getSalesDetailReport,
  getExpenseReport,
  getPendingPaymentReport,
  getProfitReport,
  getProfitDetailReport,
  getAllStoresReport,
};
