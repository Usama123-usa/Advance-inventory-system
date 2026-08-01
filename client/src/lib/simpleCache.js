// Tiny in-memory GET cache for rarely-changing lookups (categories,
// settings, stores) so navigating between pages doesn't re-fetch them every
// time. Lives for the life of the tab; nothing here needs to survive reload.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const cache = new Map();

export function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCached(key, value) {
  cache.set(key, { value, timestamp: Date.now() });
}

export function clearCached(key) {
  cache.delete(key);
}
