import axios from 'axios';
import { getCurrentStoreId } from './storeScope';
import { getCached, setCached } from './simpleCache';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  const storeId = getCurrentStoreId();
  if (storeId) {
    config.params = { ...config.params, storeId: config.params?.storeId ?? storeId };
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && window.location.pathname !== '/login') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const getErrorMessage = (error) =>
  error?.response?.data?.message || error?.message || 'Something went wrong. Please try again.';

// GET with a 5-minute in-memory cache, for rarely-changing lookups
// (categories, settings, stores) so switching pages doesn't re-fetch them
// every time. Pass { force: true } to bypass/refresh the cache.
export async function cachedGet(url, config, { force = false } = {}) {
  const cacheKey = `${url}?${JSON.stringify(config?.params || {})}`;
  if (!force) {
    const cached = getCached(cacheKey);
    if (cached) return cached;
  }
  const response = await api.get(url, config);
  setCached(cacheKey, response);
  return response;
}

export default api;
