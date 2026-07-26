const { supabase } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { assertNoSupabaseError } = require('../utils/supabaseErrors');

// GET /api/categories?search=&page=&limit=
const getCategories = asyncHandler(async (req, res) => {
  const { search = '', page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const { data, error } = await supabase.rpc('get_categories', {
    p_search: search,
    p_limit: Number(limit),
    p_offset: offset,
  });

  assertNoSupabaseError(error, 'Failed to load categories');

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

// GET /api/categories/:id
const getCategoryById = asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from('categories').select('*').eq('id', req.params.id).maybeSingle();
  assertNoSupabaseError(error, 'Failed to load category');
  if (!data) throw new ApiError(404, 'Category not found');
  res.json({ success: true, data });
});

// POST /api/categories
const createCategory = asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  const { data, error } = await supabase
    .from('categories')
    .insert({ name: name.trim(), description: description || null })
    .select('*')
    .single();

  assertNoSupabaseError(error, 'Failed to create category');
  res.status(201).json({ success: true, data });
});

// PUT /api/categories/:id
const updateCategory = asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  const { data, error } = await supabase
    .from('categories')
    .update({ name: name.trim(), description: description || null })
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to update category');
  if (!data) throw new ApiError(404, 'Category not found');
  res.json({ success: true, data });
});

// DELETE /api/categories/:id
const deleteCategory = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('categories')
    .delete()
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to delete category');
  if (!data) throw new ApiError(404, 'Category not found');
  res.json({ success: true, message: 'Category deleted successfully' });
});

module.exports = { getCategories, getCategoryById, createCategory, updateCategory, deleteCategory };
