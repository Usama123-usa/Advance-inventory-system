const { supabase } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { assertNoSupabaseError } = require('../utils/supabaseErrors');

// Products are global; stock/threshold live per-store in store_products.
// The !inner hint means a product only shows up for a store if it has been
// assigned to that store (a row exists in store_products for that pair).
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
    // Tiles keep a fixed 'box' unit (sqr-meter/rate-per-meter pricing is
    // built around it). Everything else uses the Unit field from the form
    // (Kg/Gram/Liter/Piece/Box/Dozen/Pcs/...) when provided, falling back to
    // the legacy box/pcs unitType toggle for any older caller that still
    // only sends that.
    unit: isTiles ? 'box' : body.unit?.trim() || (isOther && body.unitType === 'pcs' ? 'pcs' : isOther ? 'box' : 'pcs'),
    description: body.description || null,
    status: body.status || 'active',
    product_type: productType,
    size: isTiles ? body.size?.trim() || null : null,
    glaze_grade: isTiles ? body.glazeGrade?.trim() || null : null,
    sqr_meter: sqrMeter,
    packing_per_box: isTiles ? numOrNull(body.packingPerBox) : null,
    rate_per_meter: ratePerMeter,
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
// Admins: creates the global product, plus a store_products row for the
// Main Store and any storeIds selected via the "Add to which stores?"
// multi-select. Selected sub-stores start at zero stock; only the Main
// Store gets the entered initial quantity.
// Store managers: creates the global product, plus a single store_products
// row for their own store (req.storeId) at the entered initial quantity —
// storeIds from the request body is ignored, they can never stock Main
// Store or any other sub-store.
const createProduct = asyncHandler(async (req, res) => {
  const payload = buildProductPayload(req.body);
  const initialStock = Math.max(0, Number(req.body.quantity) || 0);
  const lowStockThreshold = Math.max(0, Number(req.body.lowStockThreshold) || 5);
  const isAdmin = req.user.role === 'admin';

  const { data: product, error } = await supabase.from('products').insert(payload).select('*').single();
  assertNoSupabaseError(error, 'Failed to create product');

  let storeProductRows;
  let stockLogStoreId;

  if (isAdmin) {
    const { data: mainStore, error: mainStoreError } = await supabase
      .from('stores')
      .select('id')
      .eq('is_main', true)
      .maybeSingle();

    assertNoSupabaseError(mainStoreError, 'Failed to resolve Main Store');
    if (!mainStore) throw new ApiError(500, 'Main Store is not configured');

    const storeIds = Array.isArray(req.body.storeIds) ? req.body.storeIds.filter(Boolean) : [];
    const targetStoreIds = Array.from(new Set([mainStore.id, ...storeIds]));
    storeProductRows = targetStoreIds.map((storeId) => ({
      store_id: storeId,
      product_id: product.id,
      stock: storeId === mainStore.id ? initialStock : 0,
      low_stock_threshold: lowStockThreshold,
    }));
    stockLogStoreId = mainStore.id;
  } else {
    storeProductRows = [
      {
        store_id: req.storeId,
        product_id: product.id,
        stock: initialStock,
        low_stock_threshold: lowStockThreshold,
      },
    ];
    stockLogStoreId = req.storeId;
  }

  const { error: spError } = await supabase.from('store_products').insert(storeProductRows);
  assertNoSupabaseError(spError, 'Failed to assign product to stores');

  if (initialStock > 0) {
    await supabase.from('inventory_logs').insert({
      store_id: stockLogStoreId,
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
// fields; storeIds here only ever ADDS new store assignments at zero stock
// and is admin-only, it never removes an existing assignment. quantity, if
// provided, sets stock for the caller's current store — req.storeId — via
// the same atomic adjust_stock() RPC the Inventory page uses.)
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
    const { data: existingRows, error: existingError } = await supabase
      .from('store_products')
      .select('store_id')
      .eq('product_id', req.params.id)
      .in('store_id', storeIds);

    assertNoSupabaseError(existingError, 'Failed to check store assignment');

    const alreadyAssigned = new Set((existingRows || []).map((row) => row.store_id));
    const newRows = storeIds
      .filter((storeId) => !alreadyAssigned.has(storeId))
      .map((storeId) => ({ store_id: storeId, product_id: req.params.id, stock: 0 }));

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

module.exports = {
  getProducts,
  getProductById,
  getProductByBarcode,
  createProduct,
  updateProduct,
  deleteProduct,
};
