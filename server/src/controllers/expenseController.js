const { supabase } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { assertNoSupabaseError } = require('../utils/supabaseErrors');

const CATEGORIES = ['food', 'transport', 'utilities', 'salaries', 'other'];

// GET /api/expenses?search=&category=&from=&to=&page=&limit=
const getExpenses = asyncHandler(async (req, res) => {
  const { search = '', category = '', from = '', to = '', page = 1, limit = 20 } = req.query;
  const rangeFrom = (Number(page) - 1) * Number(limit);
  const rangeTo = rangeFrom + Number(limit) - 1;

  let queryBuilder = supabase
    .from('expenses')
    .select('id, date, category, description, amount, users(name)', { count: 'exact' })
    .eq('store_id', req.storeId)
    .order('date', { ascending: false })
    .range(rangeFrom, rangeTo);

  if (search) queryBuilder = queryBuilder.ilike('description', `%${search}%`);
  if (category) queryBuilder = queryBuilder.eq('category', category);
  if (from) queryBuilder = queryBuilder.gte('date', from);
  if (to) queryBuilder = queryBuilder.lte('date', to);

  const { data, error, count } = await queryBuilder;
  assertNoSupabaseError(error, 'Failed to load expenses');

  const rows = data.map(({ users, ...rest }) => ({ ...rest, created_by_name: users?.name || null }));

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

// GET /api/expenses/summary  -- today's + this month's totals for the current store
const getExpenseSummary = asyncHandler(async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;

  const [todayResult, monthResult] = await Promise.all([
    supabase.from('expenses').select('amount').eq('store_id', req.storeId).eq('date', today),
    supabase.from('expenses').select('amount').eq('store_id', req.storeId).gte('date', monthStart),
  ]);

  assertNoSupabaseError(todayResult.error, 'Failed to load expense summary');
  assertNoSupabaseError(monthResult.error, 'Failed to load expense summary');

  const sum = (rows) => (rows || []).reduce((total, row) => total + Number(row.amount), 0);

  res.json({
    success: true,
    data: { todayTotal: sum(todayResult.data), monthlyTotal: sum(monthResult.data) },
  });
});

// POST /api/expenses  { date, category, description, amount }
const createExpense = asyncHandler(async (req, res) => {
  const { date, category, description, amount } = req.body;
  if (!CATEGORIES.includes(category)) throw new ApiError(400, 'Invalid expense category');

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      store_id: req.storeId,
      date: date || new Date().toISOString().slice(0, 10),
      category,
      description: description || null,
      amount: Number(amount) || 0,
      created_by: req.user.id,
    })
    .select('*')
    .single();

  assertNoSupabaseError(error, 'Failed to create expense');
  res.status(201).json({ success: true, data });
});

// PUT /api/expenses/:id
const updateExpense = asyncHandler(async (req, res) => {
  const { date, category, description, amount } = req.body;
  if (category && !CATEGORIES.includes(category)) throw new ApiError(400, 'Invalid expense category');

  const updatePayload = {};
  if (date !== undefined) updatePayload.date = date;
  if (category !== undefined) updatePayload.category = category;
  if (description !== undefined) updatePayload.description = description || null;
  if (amount !== undefined) updatePayload.amount = Number(amount) || 0;

  const { data, error } = await supabase
    .from('expenses')
    .update(updatePayload)
    .eq('id', req.params.id)
    .eq('store_id', req.storeId)
    .select('*')
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to update expense');
  if (!data) throw new ApiError(404, 'Expense not found');
  res.json({ success: true, data });
});

// DELETE /api/expenses/:id
const deleteExpense = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', req.params.id)
    .eq('store_id', req.storeId)
    .select('id')
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to delete expense');
  if (!data) throw new ApiError(404, 'Expense not found');
  res.json({ success: true, message: 'Expense deleted successfully' });
});

module.exports = { getExpenses, getExpenseSummary, createExpense, updateExpense, deleteExpense };
