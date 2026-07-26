const { supabase } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { assertNoSupabaseError } = require('../utils/supabaseErrors');

// GET /api/sales?search=&from=&to=&page=&limit=
// Note: search matches on invoice number only (PostgREST resource embedding
// doesn't support OR-filtering across an embedded table's columns).
const getSales = asyncHandler(async (req, res) => {
  const { search = '', from = '', to = '', page = 1, limit = 20 } = req.query;
  const rangeFrom = (Number(page) - 1) * Number(limit);
  const rangeTo = rangeFrom + Number(limit) - 1;

  let queryBuilder = supabase
    .from('sales')
    .select('*, customers(name), users(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(rangeFrom, rangeTo);

  if (search) queryBuilder = queryBuilder.ilike('invoice_number', `%${search}%`);
  if (from) queryBuilder = queryBuilder.gte('created_at', from);
  if (to) queryBuilder = queryBuilder.lte('created_at', to);

  const { data, error, count } = await queryBuilder;
  assertNoSupabaseError(error, 'Failed to load sales');

  const rows = data.map(({ customers, users, ...rest }) => ({
    ...rest,
    customer_name: customers?.name || null,
    cashier_name: users?.name || null,
  }));

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

// GET /api/sales/:id  (full detail, used for invoice rendering)
const getSaleById = asyncHandler(async (req, res) => {
  const { data: sale, error } = await supabase
    .from('sales')
    .select('*, customers(name, phone, email, address), users(name)')
    .eq('id', req.params.id)
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to load sale');
  if (!sale) throw new ApiError(404, 'Sale not found');

  const { data: items, error: itemsError } = await supabase
    .from('sale_items')
    .select('*, products(sku, barcode)')
    .eq('sale_id', req.params.id)
    .order('created_at', { ascending: true });

  assertNoSupabaseError(itemsError, 'Failed to load sale items');

  const { customers, users, ...saleRest } = sale;
  res.json({
    success: true,
    data: {
      ...saleRest,
      customer_name: customers?.name || null,
      customer_phone: customers?.phone || null,
      customer_email: customers?.email || null,
      customer_address: customers?.address || null,
      cashier_name: users?.name || null,
      items: items.map(({ products, ...item }) => ({ ...item, sku: products?.sku, barcode: products?.barcode })),
    },
  });
});

// POST /api/sales
// body: { customerId, items: [{ productId, quantity }], discount, paymentMethod, notes }
// Delegates to the create_sale() Postgres function so stock validation,
// totals, sale/sale_items/inventory_logs writes all happen atomically.
const createSale = asyncHandler(async (req, res) => {
  const { customerId, items, discount = 0, paymentMethod = 'cash', notes = '' } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'At least one item is required to complete a sale');
  }

  const { data: sale, error } = await supabase.rpc('create_sale', {
    p_customer_id: customerId || null,
    p_cashier_id: req.user.id,
    p_items: items,
    p_discount: Number(discount) || 0,
    p_payment_method: paymentMethod,
    p_notes: notes,
  });

  assertNoSupabaseError(error, 'Failed to complete sale');
  res.status(201).json({ success: true, data: sale });
});

module.exports = { getSales, getSaleById, createSale };
