const { supabase } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { assertNoSupabaseError } = require('../utils/supabaseErrors');

// Products are global; store_products records which stores carry a product
// plus each store's own low_stock_threshold. stock itself is a shared pool —
// every store_products row for a product holds the same value, kept in sync
// by adjust_stock/create_sale/etc. (see sql/migration_shared_stock_pool.sql)
// — so reading it scoped to req.storeId still always returns the current
// pooled quantity. The !inner hint means a product only shows up for a
// store if it has been assigned to that store (a row exists in
// store_products for that pair).
const PRODUCT_SELECT = '*, categories(name), store_products!inner(stock, low_stock_threshold, is_low_stock)';

const flattenProduct = (product) => {
  if (!product) return product;
  const { categories, store_products, ...rest } = product;
  const sp = Array.isArray(store_products) ? store_products[0] : store_products;
  return {
    ...rest,
    category_name: categories?.name || null,
    quantity: sp?.stock ?? 0,
    low_stock_threshold: sp?.low_stock_threshold ?? 0,
    is_low_stock: sp?.is_low_stock ?? false,
  };
};

// GET /api/products?search=&category=&status=&lowStock=&page=&limit=
const getProducts = asyncHandler(async (req, res) => {
  const { search = '', category = '', status = '', lowStock = '', page = 1, limit = 20 } = req.query;
  const from = (Number(page) - 1) * Number(limit);
  const to = from + Number(limit) - 1;

  let queryBuilder = supabase
    .from('products')
    .select(PRODUCT_SELECT, { count: 'exact' })
    .eq('store_products.store_id', req.storeId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (search) {
    queryBuilder = queryBuilder.or(`name.ilike.%${search}%,barcode.ilike.%${search}%,sku.ilike.%${search}%`);
  }
  if (category) queryBuilder = queryBuilder.eq('category_id', category);
  if (status) queryBuilder = queryBuilder.eq('status', status);
  if (lowStock === 'true') queryBuilder = queryBuilder.eq('store_products.is_low_stock', true);

  const { data, error, count } = await queryBuilder;
  assertNoSupabaseError(error, 'Failed to load products');

  res.json({
    success: true,
    data: data.map(flattenProduct),
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
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('id', req.params.id)
    .eq('store_products.store_id', req.storeId)
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to load product');
  if (!data) throw new ApiError(404, 'Product not found');
  res.json({ success: true, data: flattenProduct(data) });
});

// GET /api/products/barcode/:barcode
const getProductByBarcode = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('barcode', req.params.barcode)
    .eq('store_products.store_id', req.storeId)
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to look up product');
  if (!data) throw new ApiError(404, 'Product not found for this barcode');
  res.json({ success: true, data: flattenProduct(data) });
});

const numOrNull = (value) => {
  const n = Number(value);
  return value !== '' && value != null && Number.isFinite(n) ? n : null;
};

// Products come in two shapes depending on their category's type: Tiles
// (size/glaze/sqr-meter/rate/packing) or Other (article/company/unit type).
// Fields outside the given product_type are always stored as null.
const buildProductPayload = (body) => {
  const productType = body.productType === 'tiles' || body.productType === 'other' ? body.productType : null;
  const isTiles = productType === 'tiles';
  const isOther = productType === 'other';

  const sqrMeter = isTiles ? numOrNull(body.sqrMeter) : null;
  const ratePerMeter = isTiles ? numOrNull(body.ratePerMeter) : null;
  const squareMeter = isTiles ? numOrNull(body.squareMeter) : null;

  return {
    name: body.name.trim(),
    barcode: body.barcode?.trim() || null,
    sku: body.sku?.trim() || null,
    category_id: body.categoryId || null,
    purchase_price: Number(body.purchasePrice) || 0,
    // selling_price is no longer entered on the product form — pricing is
    // decided per line item at sale time, directly in the POS cart, and
    // saved on sale_items instead. This column is kept (defaulted to 0) so
    // existing rows and reports referencing it don't break.
    selling_price: Number(body.sellingPrice) || 0,
    // Tiles are sold and tracked by 'unit' (each unit's own square-meter
    // coverage drives the POS price calc — see square_meter below).
    // Everything else uses the Unit field from the form (Kg/Gram/Liter/
    // Piece/Box/Dozen/Pcs/...) when provided, falling back to the legacy
    // box/pcs unitType toggle for any older caller that still only sends that.
    unit: isTiles ? 'unit' : body.unit?.trim() || (isOther && body.unitType === 'pcs' ? 'pcs' : isOther ? 'box' : 'pcs'),
    description: body.description || null,
    status: body.status || 'active',
    product_type: productType,
    size: isTiles ? body.size?.trim() || null : null,
    glaze_grade: isTiles ? body.glazeGrade?.trim() || null : null,
    sqr_meter: sqrMeter,
    packing_per_box: isTiles ? numOrNull(body.packingPerBox) : null,
    rate_per_meter: ratePerMeter,
    // Square meters covered by one unit — used at POS time to compute
    // Total = Quantity × Price × Square Meter (see POS.jsx/CartItemRow.jsx).
    square_meter: squareMeter,
    article: isOther ? body.article?.trim() || null : null,
    company: isOther ? body.company?.trim() || null : null,
    // unit_type is no longer form-editable directly — kept populated as a
    // derived box/pcs flag purely for backward compatibility with anything
    // still reading it.
    unit_type: isOther
      ? (body.unit?.trim().toLowerCase() === 'pcs' || body.unitType === 'pcs' ? 'pcs' : 'box')
      : null,
  };
};

// POST /api/products  (admin or store_manager)
// Which stores a new product is ASSIGNED TO:
//   - Admin, with storeIds sent (the Add Product form's store-selection
//     checklist, defaulted to every active store): assigned to exactly
//     those active stores, always including the store the admin is
//     currently acting in (req.storeId) even if it was left unchecked.
//   - Anyone else (store_manager, or an admin request with no storeIds —
//     e.g. an older client): falls back to the original rule — created
//     while viewing the Main Store fans out to every active store, created
//     while viewing a sub-store stays scoped to just that store. A
//     store_manager's store_id can never be the Main Store's (sub-stores
//     are only ever created via create_sub_store()), so this naturally
//     keeps them scoped to their own store without a separate role branch.
// Stock itself is a shared pool: every store a product is assigned to holds
// the SAME quantity (kept in sync by adjust_stock/create_sale/etc. — see
// sql/migration_shared_stock_pool.sql), so every assigned row starts at the
// entered initial quantity, not zero.
const createProduct = asyncHandler(async (req, res) => {
  const payload = buildProductPayload(req.body);
  const initialStock = Math.max(0, Number(req.body.quantity) || 0);
  const lowStockThreshold = Math.max(0, Number(req.body.lowStockThreshold) || 5);

  const { data: currentStore, error: storeError } = await supabase
    .from('stores')
    .select('id, is_main')
    .eq('id', req.storeId)
    .maybeSingle();

  assertNoSupabaseError(storeError, 'Failed to resolve current store');
  if (!currentStore) throw new ApiError(404, 'Store not found');

  const { data: product, error } = await supabase.from('products').insert(payload).select('*').single();
  assertNoSupabaseError(error, 'Failed to create product');

  let targetStoreIds;

  if (req.user.role === 'admin' && Array.isArray(req.body.storeIds)) {
    const { data: allStores, error: allStoresError } = await supabase.from('stores').select('id').eq('is_active', true);
    assertNoSupabaseError(allStoresError, 'Failed to load stores');

    const activeStoreIds = new Set(allStores.map((s) => s.id));
    const chosen = new Set(req.body.storeIds.filter((id) => activeStoreIds.has(id)));
    chosen.add(currentStore.id);
    targetStoreIds = Array.from(chosen);
  } else if (currentStore.is_main) {
    const { data: allStores, error: allStoresError } = await supabase.from('stores').select('id').eq('is_active', true);
    assertNoSupabaseError(allStoresError, 'Failed to load stores');
    targetStoreIds = allStores.map((s) => s.id);
  } else {
    targetStoreIds = [currentStore.id];
  }

  const storeProductRows = targetStoreIds.map((storeId) => ({
    store_id: storeId,
    product_id: product.id,
    stock: initialStock,
    low_stock_threshold: lowStockThreshold,
  }));

  const { error: spError } = await supabase.from('store_products').insert(storeProductRows);
  assertNoSupabaseError(spError, 'Failed to assign product to stores');

  if (initialStock > 0) {
    await supabase.from('inventory_logs').insert({
      store_id: currentStore.id,
      product_id: product.id,
      change_type: 'in',
      quantity: initialStock,
      previous_quantity: 0,
      new_quantity: initialStock,
      reason: 'Initial stock on product creation',
      created_by: req.user.id,
    });
  }

  res.status(201).json({ success: true, data: product });
});

// PUT /api/products/:id  (admin or store_manager — edits global product
// fields; storeIds here only ever ADDS new store assignments (joining the
// shared stock pool at its current value) and is admin-only, it never
// removes an existing assignment. quantity, if provided, adjusts stock via
// the same atomic adjust_stock() RPC the Inventory page uses — which now
// applies the change to every store carrying this product, not just
// req.storeId's row (see sql/migration_shared_stock_pool.sql).)
const updateProduct = asyncHandler(async (req, res) => {
  const payload = buildProductPayload(req.body);

  const { data, error } = await supabase
    .from('products')
    .update(payload)
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();

  assertNoSupabaseError(error, 'Failed to update product');
  if (!data) throw new ApiError(404, 'Product not found');

  if (req.body.quantity !== undefined && req.body.quantity !== '') {
    const desiredStock = Math.max(0, Number(req.body.quantity) || 0);

    const { data: sp, error: spLookupError } = await supabase
      .from('store_products')
      .select('stock')
      .eq('store_id', req.storeId)
      .eq('product_id', req.params.id)
      .maybeSingle();

    assertNoSupabaseError(spLookupError, 'Failed to look up current stock');

    if (sp && desiredStock !== sp.stock) {
      const { error: adjustError } = await supabase.rpc('adjust_stock', {
        p_store_id: req.storeId,
        p_product_id: req.params.id,
        p_delta: desiredStock - sp.stock,
        p_change_type: 'adjustment',
        p_reason: 'Updated from product edit form',
        p_user_id: req.user.id,
      });
      assertNoSupabaseError(adjustError, 'Failed to update stock');
    }
  }

  const storeIds = req.user.role === 'admin' && Array.isArray(req.body.storeIds) ? req.body.storeIds.filter(Boolean) : [];
  if (storeIds.length) {
    // Need every existing assignment's stock (not just which stores are
    // already assigned) — stock is a shared pool, so a newly-added store
    // joins at whatever the pool currently holds, not zero.
    const { data: existingRows, error: existingError } = await supabase
      .from('store_products')
      .select('store_id, stock')
      .eq('product_id', req.params.id);

    assertNoSupabaseError(existingError, 'Failed to check store assignment');

    const alreadyAssigned = new Set((existingRows || []).map((row) => row.store_id));
    const currentPoolStock = existingRows?.[0]?.stock ?? 0;
    const newRows = storeIds
      .filter((storeId) => !alreadyAssigned.has(storeId))
      .map((storeId) => ({ store_id: storeId, product_id: req.params.id, stock: currentPoolStock }));

    if (newRows.length) {
      const { error: insertError } = await supabase.from('store_products').insert(newRows);
      assertNoSupabaseError(insertError, 'Failed to assign product to additional stores');
    }
  }

  res.json({ success: true, data });
});

// DELETE /api/products/:id  -- permanent hard delete as required (cascades
// through store_products and inventory_logs)
const deleteProduct = asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from('products').delete().eq('id', req.params.id).select('id').maybeSingle();
  assertNoSupabaseError(error, 'Failed to delete product');
  if (!data) throw new ApiError(404, 'Product not found');
  res.json({ success: true, message: 'Product permanently deleted' });
});

// POST /api/products/bulk-delete  { ids: [] }  -- permanent hard delete of
// multiple products in one request (same semantics as deleteProduct above).
const bulkDeleteProducts = asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) throw new ApiError(400, 'No product ids provided');

  const { data, error } = await supabase.from('products').delete().in('id', ids).select('id');
  assertNoSupabaseError(error, 'Failed to delete products');
  res.json({ success: true, message: `${data.length} product(s) permanently deleted` });
});

module.exports = {
  getProducts,
  getProductById,
  getProductByBarcode,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkDeleteProducts,
};
