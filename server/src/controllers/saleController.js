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
    .select(
      'id, invoice_number, grand_total, payment_method, payment_status, paid_amount, remaining_balance, created_at, customer_name, customer_phone, customers(name, phone), users(name)',
      { count: 'exact' }
    )
    .eq('store_id', req.storeId)
    .order('created_at', { ascending: false })
    .range(rangeFrom, rangeTo);

  if (search) queryBuilder = queryBuilder.ilike('invoice_number', `%${search}%`);
  if (from) queryBuilder = queryBuilder.gte('created_at', from);
  if (to) queryBuilder = queryBuilder.lte('created_at', to);

  const { data, error, count } = await queryBuilder;
  assertNoSupabaseError(error, 'Failed to load sales');

  // A sale's own customer_name/phone (free-text, filled in for partial
  // payments/walk-ins) take priority over the linked customer record.
  const rows = data.map(({ customers, users, customer_name, customer_phone, ...rest }) => ({
    ...rest,
    customer_name: customer_name || customers?.name || null,
    customer_phone: customer_phone || customers?.phone || null,
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
    .eq('store_id', req.storeId)
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to load sale');
  if (!sale) throw new ApiError(404, 'Sale not found');

  const { data: items, error: itemsError } = await supabase
    .from('sale_items')
    .select('id, product_name, quantity, unit_price, total, sqr_meter, rate_per_meter, products(sku, barcode)')
    .eq('sale_id', req.params.id)
    .order('created_at', { ascending: true });

  assertNoSupabaseError(itemsError, 'Failed to load sale items');

  const { customers, users, ...saleRest } = sale;
  res.json({
    success: true,
    data: {
      ...saleRest,
      customer_name: saleRest.customer_name || customers?.name || null,
      customer_phone: saleRest.customer_phone || customers?.phone || null,
      customer_email: customers?.email || null,
      customer_address: saleRest.customer_address || customers?.address || null,
      customer_cnic: saleRest.customer_cnic || null,
      cashier_name: users?.name || null,
      items: items.map(({ products, ...item }) => ({ ...item, sku: products?.sku, barcode: products?.barcode })),
    },
  });
});

// GET /api/sales/pending-payments  -- customers with an outstanding balance
// for the current store (Feature: Pending Payments tracking)
const getPendingPayments = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('customer_balances')
    .select('id, customer_name, customer_phone, customer_cnic, total_remaining_balance, updated_at')
    .eq('store_id', req.storeId)
    .gt('total_remaining_balance', 0)
    .order('updated_at', { ascending: false });

  assertNoSupabaseError(error, 'Failed to load pending payments');
  res.json({ success: true, data });
});

// PUT /api/sales/pending-payments/:id
// body: { customerName, customerPhone, customerCnic, totalRemainingBalance }
// Edits a customer_balances row directly — contact details and/or a manual
// correction to the outstanding amount.
const updatePendingPayment = asyncHandler(async (req, res) => {
  const { customerName, customerPhone, customerCnic, totalRemainingBalance } = req.body;

  const updates = {};
  if (customerName !== undefined) updates.customer_name = customerName.trim() || 'Unknown';
  if (customerPhone !== undefined) updates.customer_phone = customerPhone.trim() || null;
  if (customerCnic !== undefined) updates.customer_cnic = customerCnic.trim() || null;
  if (totalRemainingBalance !== undefined) updates.total_remaining_balance = Number(totalRemainingBalance);

  const { data, error } = await supabase
    .from('customer_balances')
    .update(updates)
    .eq('id', req.params.id)
    .eq('store_id', req.storeId)
    .select('id, customer_name, customer_phone, customer_cnic, total_remaining_balance, updated_at')
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to update pending payment');
  if (!data) throw new ApiError(404, 'Pending payment record not found');

  res.json({ success: true, data });
});

// POST /api/sales/pending-payments/:id/payment
// body: { amount }
// Records a payment against the outstanding balance via record_customer_payment().
const receivePendingPayment = asyncHandler(async (req, res) => {
  const { amount } = req.body;

  const { data, error } = await supabase.rpc('record_customer_payment', {
    p_store_id: req.storeId,
    p_balance_id: req.params.id,
    p_amount: Number(amount),
  });

  assertNoSupabaseError(error, 'Failed to record payment');
  res.json({ success: true, data });
});

// DELETE /api/sales/:id  (admin only)
// Reverses the sale via delete_sale(): restores stock, reverses any
// outstanding balance it contributed, then removes the sale (and its
// sale_items, via cascade). Irreversible — there is no undo for this.
const deleteSale = asyncHandler(async (req, res) => {
  const { error } = await supabase.rpc('delete_sale', {
    p_store_id: req.storeId,
    p_sale_id: req.params.id,
    p_deleted_by: req.user.id,
  });

  assertNoSupabaseError(error, 'Failed to delete sale');
  res.json({ success: true, message: 'Sale deleted successfully' });
});

// POST /api/sales
// body: { customerId, items: [{ productId, quantity }], discount, paymentMethod,
//         notes, paidAmount, customerName, customerPhone, customerAddress, customerCnic }
// Delegates to the create_sale() Postgres function so stock validation,
// totals, sale/sale_items/inventory_logs/customer_balances writes all happen
// atomically. Omitting paidAmount means "paid in full" — customer info stays
// fully optional in that case; it only matters for partial payment tracking.
const createSale = asyncHandler(async (req, res) => {
  const {
    customerId,
    items,
    discount = 0,
    paymentMethod = 'cash',
    notes = '',
    paidAmount,
    customerName,
    customerPhone,
    customerAddress,
    customerCnic,
  } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'At least one item is required to complete a sale');
  }

  const { data: sale, error } = await supabase.rpc('create_sale', {
    p_store_id: req.storeId,
    p_customer_id: customerId || null,
    p_cashier_id: req.user.id,
    p_items: items,
    p_discount: Number(discount) || 0,
    p_payment_method: paymentMethod,
    p_notes: notes,
    p_paid_amount: paidAmount === undefined || paidAmount === null || paidAmount === '' ? null : Number(paidAmount),
    p_customer_name: customerName || null,
    p_customer_phone: customerPhone || null,
    p_customer_address: customerAddress || null,
    p_customer_cnic: customerCnic || null,
  });

  assertNoSupabaseError(error, 'Failed to complete sale');
  res.status(201).json({ success: true, data: sale });
});

module.exports = {
  getSales,
  getSaleById,
  getPendingPayments,
  updatePendingPayment,
  receivePendingPayment,
  createSale,
  deleteSale,
};
