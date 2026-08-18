// Retries a Supabase query/RPC when it fails with a transient network error
// (e.g. ECONNRESET from a cold/idle connection to Supabase) instead of
// letting a one-off blip surface as a 500 to the client.
const TRANSIENT_ERROR_PATTERN = /fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up/i;

function isTransientSupabaseError(error) {
  if (!error) return false;
  return TRANSIENT_ERROR_PATTERN.test(`${error.message || ''} ${error.details || ''}`);
}

// `queryFactory` must be a function that returns a *fresh* supabase-js query
// each call (a query builder can only be awaited once), e.g.:
//   withSupabaseRetry(() => supabase.rpc('get_store_dashboard', { p_store_id }))
async function withSupabaseRetry(queryFactory, { retries = 2, baseDelayMs = 300 } = {}) {
  let result;
  for (let attempt = 0; attempt <= retries; attempt++) {
    result = await queryFactory();
    if (!isTransientSupabaseError(result.error)) return result;
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  return result;
}

module.exports = { withSupabaseRetry, isTransientSupabaseError };
