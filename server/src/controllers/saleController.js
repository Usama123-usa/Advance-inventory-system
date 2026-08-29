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
      'id, invoice_number, grand_total, payment_method, payment_status, paid_amount, remaining_balance, created_at, sale_date, customer_name, customer_phone, customers(name, phone), users(name)',
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
    .select('id, customer_name, customer_phone, customer_address, total_remaining_balance, updated_at')
    .eq('store_id', req.storeId)
    .gt('total_remaining_balance', 0)
    .order('updated_at', { ascending: false });

  assertNoSupabaseError(error, 'Failed to load pending payments');
  res.json({ success: true, data });
});

// POST /api/sales/pending-payments
// body: { customerName, customerPhone, customerAddress, amount, paymentDate }
// "Add New Customer" — records an opening pending balance that isn't tied to
// any sale, via create_customer_balance().
const createPendingCustomer = asyncHandler(async (req, res) => {
  const { customerName, customerPhone, customerAddress, amount, paymentDate } = req.body;

  if (!customerName || !String(customerName).trim()) {
    throw new ApiError(400, 'Customer name is required');
  }
  if (!customerPhone || !String(customerPhone).trim()) {
    throw new ApiError(400, 'Customer phone is required so this debt can be traced back to them');
  }
  if (!amount || Number(amount) <= 0) {
    throw new ApiError(400, 'Amount must be greater than zero');
  }

  const { data, error } = await supabase.rpc('create_customer_balance', {
    p_store_id: req.storeId,
    p_customer_name: customerName,
    p_customer_phone: customerPhone || null,
    p_customer_address: customerAddress || null,
    p_amount: Number(amount),
    p_payment_date: paymentDate || null,
    p_created_by: req.user.id,
  });

  assertNoSupabaseError(error, 'Failed to add customer');
  res.status(201).json({ success: true, data });
});

// GET /api/sales/pending-payments/:id/history
// Full charge/payment ledger for one customer_balances row.
const getPendingPaymentHistory = asyncHandler(async (req, res) => {
  const { data: balance, error: balanceError } = await supabase
    .from('customer_balances')
    .select('id, customer_name, customer_phone, customer_address, total_remaining_balance')
    .eq('id', req.params.id)
    .eq('store_id', req.storeId)
    .maybeSingle();

  assertNoSupabaseError(balanceError, 'Failed to load customer');
  if (!balance) throw new ApiError(404, 'Pending payment record not found');

  const { data: history, error } = await supabase
    .from('customer_payment_history')
    .select('id, entry_type, amount, payment_date, notes, created_at')
    .eq('customer_balance_id', req.params.id)
    .order('payment_date', { ascending: true })
    .order('created_at', { ascending: true });

  assertNoSupabaseError(error, 'Failed to load payment history');
  res.json({ success: true, data: { customer: balance, history } });
});

// PUT /api/sales/pending-payments/:id
// body: { customerName, customerPhone, customerAddress, totalRemainingBalance }
// Edits a customer_balances row directly — contact details and/or a manual
// correction to the outstanding amount.
const updatePendingPayment = asyncHandler(async (req, res) => {
  const { customerName, customerPhone, customerAddress, totalRemainingBalance } = req.body;

  const updates = {};
  if (customerName !== undefined) updates.customer_name = customerName.trim() || 'Unknown';
  if (customerPhone !== undefined) updates.customer_phone = customerPhone.trim() || null;
  if (customerAddress !== undefined) updates.customer_address = customerAddress.trim() || null;
  if (totalRemainingBalance !== undefined) updates.total_remaining_balance = Number(totalRemainingBalance);

  const { data, error } = await supabase
    .from('customer_balances')
    .update(updates)
    .eq('id', req.params.id)
    .eq('store_id', req.storeId)
    .select('id, customer_name, customer_phone, customer_address, total_remaining_balance, updated_at')
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to update pending payment');
  if (!data) throw new ApiError(404, 'Pending payment record not found');

  res.json({ success: true, data });
});

// POST /api/sales/pending-payments/:id/payment
// body: { amount, paymentDate }
// Records a payment against the outstanding balance via record_customer_payment().
const receivePendingPayment = asyncHandler(async (req, res) => {
  const { amount, paymentDate } = req.body;

  const { data, error } = await supabase.rpc('record_customer_payment', {
    p_store_id: req.storeId,
    p_balance_id: req.params.id,
    p_amount: Number(amount),
    p_payment_date: paymentDate || null,
    p_created_by: req.user.id,
  });

  assertNoSupabaseError(error, 'Failed to record payment');
  res.json({ success: true, data });
});

// DELETE /api/sales/pending-payments/:id  (admin only)
// Removes a customer_balances row (and its history, via cascade) — a
// write-off/void of the pending-payment record itself. Does not touch the
// originating sale's own paid_amount/remaining_balance fields.
const deletePendingPayment = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('customer_balances')
    .delete()
    .eq('id', req.params.id)
    .eq('store_id', req.storeId)
    .select('id')
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to delete pending payment');
  if (!data) throw new ApiError(404, 'Pending payment record not found');
  res.json({ success: true, message: 'Pending payment record deleted' });
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
// body: { invoiceNumber, customerId, items: [{ productId, quantity, unitPrice }],
//         discount, paymentMethod, notes, paidAmount, customerName,
//         customerPhone, customerAddress, customerCnic, saleDate }
// Delegates to the create_sale() Postgres function so stock validation,
// totals, sale/sale_items/inventory_logs/customer_balances writes all happen
// atomically. Each item's unitPrice is entered by the cashier in the POS
// cart — the product catalog no longer supplies a price, and this typed
// price becomes the permanent price of record on the invoice (for Tiles
// products, create_sale() itself applies the Square Meter ÷ Units Per Box
// formula to this raw price — the client never premultiplies it).
// invoiceNumber is entered manually by the cashier too — the database no
// longer generates one — and must be unique within the current store
// (checked inside create_sale() itself, before anything is written).
// saleDate defaults to today inside create_sale() when omitted, but the POS
// cart always sends the cashier's selected date explicitly. Omitting
// paidAmount means "paid in full" — customer info stays fully optional in
// that case; it only matters for partial payment tracking.
const createSale = asyncHandler(async (req, res) => {
  const {
    invoiceNumber,
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
    saleDate,
  } = req.body;

  if (!invoiceNumber || !String(invoiceNumber).trim()) {
    throw new ApiError(400, 'Invoice number is required');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'At least one item is required to complete a sale');
  }
  if (items.some((i) => i.unitPrice === undefined || i.unitPrice === null || Number(i.unitPrice) < 0)) {
    throw new ApiError(400, 'Every item needs a valid selling price');
  }

  const { data: sale, error } = await supabase.rpc('create_sale', {
    p_store_id: req.storeId,
    p_customer_id: customerId || null,
    p_cashier_id: req.user.id,
    p_items: items,
    p_discount: Math.max(Number(discount) || 0, 0),
    p_payment_method: paymentMethod,
    p_notes: notes,
    p_invoice_number: String(invoiceNumber).trim(),
    p_paid_amount: paidAmount === undefined || paidAmount === null || paidAmount === '' ? null : Number(paidAmount),
    p_customer_name: customerName || null,
    p_customer_phone: customerPhone || null,
    p_customer_address: customerAddress || null,
    p_customer_cnic: customerCnic || null,
    p_sale_date: saleDate || null,
  });

  assertNoSupabaseError(error, 'Failed to complete sale');
  res.status(201).json({ success: true, data: sale });
});

// POST /api/sales/:id/return  { items: [{ saleItemId, quantity }], reason }
// Returns specific line items from a specific invoice via create_sale_return():
// decrements the sold quantity on each sale_item, restocks store_products,
// and recomputes the sale's subtotal/tax/grand_total/paid_amount/
// remaining_balance/payment_status. Rejects any item whose requested
// quantity exceeds what's still on that line.
const createSaleReturn = asyncHandler(async (req, res) => {
  const { items, reason } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'Select at least one product to return');
  }

  const normalizedItems = items.map((item) => ({
    saleItemId: item.saleItemId,
    quantity: Number(item.quantity),
  }));

  if (normalizedItems.some((item) => !item.saleItemId || !item.quantity || item.quantity <= 0)) {
    throw new ApiError(400, 'Every returned product needs a valid quantity greater than 0');
  }

  const { data, error } = await supabase.rpc('create_sale_return', {
    p_store_id: req.storeId,
    p_sale_id: req.params.id,
    p_items: normalizedItems,
    p_reason: reason || null,
    p_user_id: req.user.id,
  });

  assertNoSupabaseError(error, 'Failed to save stock return');
  res.status(201).json({ success: true, data: { id: data } });
});

module.exports = {
  getSales,
  getSaleById,
  getPendingPayments,
  createPendingCustomer,
  getPendingPaymentHistory,
  updatePendingPayment,
  receivePendingPayment,
  deletePendingPayment,
  createSale,
  deleteSale,
  createSaleReturn,
};
