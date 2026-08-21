const { supabase } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { assertNoSupabaseError } = require('../utils/supabaseErrors');

const flattenExpenseRow = (row) => {
  const { users, expense_category_links, ...rest } = row;
  return {
    ...rest,
    created_by_name: users?.name || null,
    categories: (expense_category_links || []).map((link) => link.expense_categories).filter(Boolean),
  };
};

// GET /api/expenses/categories -- feeds the multi-select in the add/edit form
const getExpenseCategories = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('expense_categories')
    .select('id, name')
    .eq('is_active', true)
    .order('name', { ascending: true });

  assertNoSupabaseError(error, 'Failed to load expense categories');
  res.json({ success: true, data });
});

// GET /api/expenses?search=&category=&from=&to=&page=&limit=
const getExpenses = asyncHandler(async (req, res) => {
  const { search = '', category = '', from = '', to = '', page = 1, limit = 20 } = req.query;
  const rangeFrom = (Number(page) - 1) * Number(limit);
  const rangeTo = rangeFrom + Number(limit) - 1;

  let queryBuilder = supabase
    .from('expenses')
    .select('id, date, description, amount, users(name), expense_category_links(expense_categories(id, name))', { count: 'exact' })
    .eq('store_id', req.storeId)
    .order('date', { ascending: false })
    .range(rangeFrom, rangeTo);

  if (search) queryBuilder = queryBuilder.ilike('description', `%${search}%`);
  if (from) queryBuilder = queryBuilder.gte('date', from);
  if (to) queryBuilder = queryBuilder.lte('date', to);

  if (category) {
    const { data: linkedIds, error: linkError } = await supabase
      .from('expense_category_links')
      .select('expense_id')
      .eq('category_id', category);
    assertNoSupabaseError(linkError, 'Failed to filter expenses by category');

    const expenseIds = (linkedIds || []).map((row) => row.expense_id);
    if (expenseIds.length === 0) {
      return res.json({ success: true, data: [], pagination: { total: 0, page: Number(page), limit: Number(limit), totalPages: 0 } });
    }
    queryBuilder = queryBuilder.in('id', expenseIds);
  }

  const { data, error, count } = await queryBuilder;
  assertNoSupabaseError(error, 'Failed to load expenses');

  res.json({
    success: true,
    data: data.map(flattenExpenseRow),
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

const normalizeCategoryIds = (categoryIds) =>
  Array.isArray(categoryIds) ? [...new Set(categoryIds.filter(Boolean))] : [];

// POST /api/expenses  { date, categoryIds, description, amount }
const createExpense = asyncHandler(async (req, res) => {
  const { date, categoryIds, description, amount } = req.body;
  const ids = normalizeCategoryIds(categoryIds);
  if (ids.length === 0) throw new ApiError(400, 'Select at least one expense category');

  const { data: expense, error } = await supabase
    .from('expenses')
    .insert({
      store_id: req.storeId,
      date: date || new Date().toISOString().slice(0, 10),
      description: description || null,
      amount: Number(amount) || 0,
      created_by: req.user.id,
    })
    .select('id, date, description, amount')
    .single();

  assertNoSupabaseError(error, 'Failed to create expense');

  const { error: linkError } = await supabase.rpc('save_expense_categories', {
    p_expense_id: expense.id,
    p_category_ids: ids,
  });

  if (linkError) {
    await supabase.from('expenses').delete().eq('id', expense.id);
    assertNoSupabaseError(linkError, 'Failed to save expense categories');
  }

  res.status(201).json({ success: true, data: { ...expense, category_ids: ids } });
});

// PUT /api/expenses/:id
const updateExpense = asyncHandler(async (req, res) => {
  const { date, categoryIds, description, amount } = req.body;

  const updatePayload = {};
  if (date !== undefined) updatePayload.date = date;
  if (description !== undefined) updatePayload.description = description || null;
  if (amount !== undefined) updatePayload.amount = Number(amount) || 0;

  const { data, error } = await supabase
    .from('expenses')
    .update(updatePayload)
    .eq('id', req.params.id)
    .eq('store_id', req.storeId)
    .select('id, date, description, amount')
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to update expense');
  if (!data) throw new ApiError(404, 'Expense not found');

  if (categoryIds !== undefined) {
    const ids = normalizeCategoryIds(categoryIds);
    if (ids.length === 0) throw new ApiError(400, 'Select at least one expense category');

    const { error: linkError } = await supabase.rpc('save_expense_categories', {
      p_expense_id: data.id,
      p_category_ids: ids,
    });
    assertNoSupabaseError(linkError, 'Failed to save expense categories');
  }

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

module.exports = {
  getExpenses,
  getExpenseSummary,
  getExpenseCategories,
  createExpense,
  updateExpense,
  deleteExpense,
};
