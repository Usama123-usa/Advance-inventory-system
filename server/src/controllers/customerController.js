const { supabase } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { assertNoSupabaseError } = require('../utils/supabaseErrors');

// GET /api/customers?search=&page=&limit=
const getCustomers = asyncHandler(async (req, res) => {
  const { search = '', page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const { data, error } = await supabase.rpc('get_customers', {
    p_search: search,
    p_limit: Number(limit),
    p_offset: offset,
  });

  assertNoSupabaseError(error, 'Failed to load customers');

  const total = data[0]?.total_count ? Number(data[0].total_count) : 0;
  const rows = data.map(({ total_count, ...rest }) => rest);

  res.json({
    success: true,
    data: rows,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    },
  });
});

// GET /api/customers/:id
const getCustomerById = asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from('customers').select('*').eq('id', req.params.id).maybeSingle();
  assertNoSupabaseError(error, 'Failed to load customer');
  if (!data) throw new ApiError(404, 'Customer not found');
  res.json({ success: true, data });
});

// GET /api/customers/:id/purchases
const getCustomerPurchases = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('sales')
    .select('id, invoice_number, grand_total, payment_method, created_at, sale_items(count)')
    .eq('customer_id', req.params.id)
    .order('created_at', { ascending: false });

  assertNoSupabaseError(error, 'Failed to load purchase history');

  const rows = data.map(({ sale_items, ...rest }) => ({
    ...rest,
    item_count: sale_items?.[0]?.count || 0,
  }));

  res.json({ success: true, data: rows });
});

// POST /api/customers
const createCustomer = asyncHandler(async (req, res) => {
  const { name, phone, email, address } = req.body;
  const { data, error } = await supabase
    .from('customers')
    .insert({ name: name.trim(), phone: phone || null, email: email || null, address: address || null })
    .select('*')
    .single();

  assertNoSupabaseError(error, 'Failed to create customer');
  res.status(201).json({ success: true, data });
});

// PUT /api/customers/:id
const updateCustomer = asyncHandler(async (req, res) => {
  const { name, phone, email, address } = req.body;
  const { data, error } = await supabase
    .from('customers')
    .update({ name: name.trim(), phone: phone || null, email: email || null, address: address || null })
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to update customer');
  if (!data) throw new ApiError(404, 'Customer not found');
  res.json({ success: true, data });
});

// DELETE /api/customers/:id
const deleteCustomer = asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from('customers').delete().eq('id', req.params.id).select('id').maybeSingle();
  assertNoSupabaseError(error, 'Failed to delete customer');
  if (!data) throw new ApiError(404, 'Customer not found');
  res.json({ success: true, message: 'Customer deleted successfully' });
});

module.exports = {
  getCustomers,
  getCustomerById,
  getCustomerPurchases,
  createCustomer,
  updateCustomer,
  deleteCustomer,
};
