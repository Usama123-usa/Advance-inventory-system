const { supabase, PRODUCT_IMAGE_BUCKET } = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { assertNoSupabaseError } = require('../utils/supabaseErrors');

// GET /api/settings
const getSettings = asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from('settings').select('*').order('created_at', { ascending: true }).limit(1).maybeSingle();
  assertNoSupabaseError(error, 'Failed to load settings');
  res.json({ success: true, data: data || null });
});

// PUT /api/settings
const updateSettings = asyncHandler(async (req, res) => {
  const { shopName, address, phone, email, currency, taxRate, invoiceFooter, theme, logoUrl } = req.body;

  const { data: existing } = await supabase.from('settings').select('id').order('created_at', { ascending: true }).limit(1).maybeSingle();

  const patch = {
    ...(shopName !== undefined && { shop_name: shopName }),
    ...(address !== undefined && { address }),
    ...(phone !== undefined && { phone }),
    ...(email !== undefined && { email }),
    ...(currency !== undefined && { currency }),
    ...(taxRate !== undefined && { tax_rate: taxRate }),
    ...(invoiceFooter !== undefined && { invoice_footer: invoiceFooter }),
    ...(theme !== undefined && { theme }),
    ...(logoUrl !== undefined && { logo_url: logoUrl }),
  };

  let result;
  if (existing) {
    result = await supabase.from('settings').update(patch).eq('id', existing.id).select('*').single();
  } else {
    result = await supabase
      .from('settings')
      .insert({ shop_name: shopName || 'My Shop', currency: currency || 'USD', tax_rate: taxRate || 0, ...patch })
      .select('*')
      .single();
  }

  assertNoSupabaseError(result.error, 'Failed to update settings');
  res.json({ success: true, data: result.data });
});

// POST /api/settings/logo  (multipart file upload -> Supabase Storage)
const uploadLogo = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'No file uploaded');

  const ext = req.file.originalname.split('.').pop();
  const path = `logo/${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });

  if (error) throw new ApiError(500, `Logo upload failed: ${error.message}`);

  const { data } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path);
  res.json({ success: true, data: { logoUrl: data.publicUrl } });
});

module.exports = { getSettings, updateSettings, uploadLogo };
