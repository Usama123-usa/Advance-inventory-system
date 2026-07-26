const { supabase, PRODUCT_IMAGE_BUCKET } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { assertNoSupabaseError } = require('../utils/supabaseErrors');

const PRODUCT_SELECT = '*, categories(name)';

const flattenCategory = (product) => {
  if (!product) return product;
  const { categories, ...rest } = product;
  return { ...rest, category_name: categories?.name || null };
};

// GET /api/products?search=&category=&status=&lowStock=&page=&limit=
const getProducts = asyncHandler(async (req, res) => {
  const { search = '', category = '', status = '', lowStock = '', page = 1, limit = 20 } = req.query;
  const from = (Number(page) - 1) * Number(limit);
  const to = from + Number(limit) - 1;

  let queryBuilder = supabase
    .from('products')
    .select(PRODUCT_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (search) {
    queryBuilder = queryBuilder.or(`name.ilike.%${search}%,barcode.ilike.%${search}%,sku.ilike.%${search}%`);
  }
  if (category) queryBuilder = queryBuilder.eq('category_id', category);
  if (status) queryBuilder = queryBuilder.eq('status', status);
  if (lowStock === 'true') queryBuilder = queryBuilder.eq('is_low_stock', true);

  const { data, error, count } = await queryBuilder;
  assertNoSupabaseError(error, 'Failed to load products');

  res.json({
    success: true,
    data: data.map(flattenCategory),
    pagination: {
      total: count || 0,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil((count || 0) / Number(limit)),
    },
  });
});

// GET /api/products/:id
const getProductById = asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from('products').select(PRODUCT_SELECT).eq('id', req.params.id).maybeSingle();
  assertNoSupabaseError(error, 'Failed to load product');
  if (!data) throw new ApiError(404, 'Product not found');
  res.json({ success: true, data: flattenCategory(data) });
});

// GET /api/products/barcode/:barcode
const getProductByBarcode = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('barcode', req.params.barcode)
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to look up product');
  if (!data) throw new ApiError(404, 'Product not found for this barcode');
  res.json({ success: true, data: flattenCategory(data) });
});

const buildProductPayload = (body) => ({
  name: body.name.trim(),
  barcode: body.barcode?.trim() || null,
  sku: body.sku?.trim() || null,
  category_id: body.categoryId || null,
  purchase_price: Number(body.purchasePrice) || 0,
  selling_price: Number(body.sellingPrice) || 0,
  quantity: Number(body.quantity) || 0,
  unit: body.unit?.trim() || 'pcs',
  low_stock_threshold: Number(body.lowStockThreshold) || 5,
  description: body.description || null,
  status: body.status || 'active',
});

// POST /api/products
const createProduct = asyncHandler(async (req, res) => {
  const payload = buildProductPayload(req.body);
  let imageUrl = req.body.imageUrl || null;

  if (req.file) {
    imageUrl = await uploadProductImage(req.file);
  }

  const { data: product, error } = await supabase
    .from('products')
    .insert({ ...payload, image_url: imageUrl })
    .select('*')
    .single();

  assertNoSupabaseError(error, 'Failed to create product');

  if (payload.quantity > 0) {
    await supabase.from('inventory_logs').insert({
      product_id: product.id,
      change_type: 'in',
      quantity: payload.quantity,
      previous_quantity: 0,
      new_quantity: payload.quantity,
      reason: 'Initial stock on product creation',
      created_by: req.user.id,
    });
  }

  res.status(201).json({ success: true, data: product });
});

// PUT /api/products/:id
const updateProduct = asyncHandler(async (req, res) => {
  const { data: existing, error: fetchError } = await supabase
    .from('products')
    .select('image_url')
    .eq('id', req.params.id)
    .maybeSingle();

  assertNoSupabaseError(fetchError, 'Failed to load product');
  if (!existing) throw new ApiError(404, 'Product not found');

  const payload = buildProductPayload(req.body);
  let imageUrl = req.body.imageUrl || existing.image_url;

  if (req.file) {
    imageUrl = await uploadProductImage(req.file);
  }

  // Quantity is intentionally excluded — stock changes must go through the
  // Inventory stock-in/stock-out endpoints so every change is audit-logged.
  const { quantity, ...updatable } = payload;

  const { data, error } = await supabase
    .from('products')
    .update({ ...updatable, image_url: imageUrl })
    .eq('id', req.params.id)
    .select('*')
    .single();

  assertNoSupabaseError(error, 'Failed to update product');
  res.json({ success: true, data });
});

// DELETE /api/products/:id  -- permanent hard delete as required
const deleteProduct = asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from('products').delete().eq('id', req.params.id).select('id').maybeSingle();
  assertNoSupabaseError(error, 'Failed to delete product');
  if (!data) throw new ApiError(404, 'Product not found');
  res.json({ success: true, message: 'Product permanently deleted' });
});

async function uploadProductImage(file) {
  const ext = file.originalname.split('.').pop();
  const path = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });

  if (error) throw new ApiError(500, `Image upload failed: ${error.message}`);

  const { data } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

module.exports = {
  getProducts,
  getProductById,
  getProductByBarcode,
  createProduct,
  updateProduct,
  deleteProduct,
};
