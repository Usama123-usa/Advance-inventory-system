// Holds the "current store" an admin is viewing, outside of React, so the
// axios interceptor in lib/api.js can auto-attach it to every request
// without every page threading a storeId prop through its API calls.
// Mirrors how the auth token is read straight from localStorage.
const STORAGE_KEY = 'currentStoreId';

let currentStoreId = localStorage.getItem(STORAGE_KEY) || null;

export const getCurrentStoreId = () => currentStoreId;

export const setCurrentStoreId = (storeId) => {
  currentStoreId = storeId || null;
  if (currentStoreId) {
    localStorage.setItem(STORAGE_KEY, currentStoreId);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
};

export const clearCurrentStoreId = () => setCurrentStoreId(null);
