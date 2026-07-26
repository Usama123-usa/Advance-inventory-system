const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

// Single admin client for the whole backend: every controller reads/writes
// the database through this (PostgREST + RPC), and it also handles Storage
// uploads. The secret key bypasses Row Level Security, which is safe here
// because this client is only ever used server-side.
let supabase;

if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
} else {
  console.warn('[supabase] SUPABASE_URL / SUPABASE_SECRET_KEY not set. Database and storage calls will fail until configured.');
  const notConfigured = () => {
    throw new Error('Supabase is not configured: set SUPABASE_URL and SUPABASE_SECRET_KEY');
  };
  supabase = new Proxy({}, { get: notConfigured });
}

const PRODUCT_IMAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'product-images';

module.exports = { supabase, PRODUCT_IMAGE_BUCKET };
