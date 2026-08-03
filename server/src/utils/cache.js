// Tiny in-memory TTL cache. Used to avoid re-hitting Supabase on every
// single request for data that barely changes request-to-request (the
// logged-in user's active/role status, store lookups). A stale read here
// is bounded by ttlMs, so keep TTLs short for anything security-sensitive.
const store = new Map();

const get = (key) => {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
};

const set = (key, value, ttlMs) => {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
};

const del = (key) => store.delete(key);

module.exports = { get, set, del };
