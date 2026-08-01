import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { cachedGet } from '@/lib/api';
import { useAuth } from './AuthContext';
import { getCurrentStoreId, setCurrentStoreId as persistCurrentStoreId } from '@/lib/storeScope';

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [stores, setStores] = useState([]);
  const [currentStoreId, setCurrentStoreIdState] = useState(() => getCurrentStoreId());
  const [loading, setLoading] = useState(false);

  // Cached for 5 minutes on passive loads; pass force=true after a
  // create/update/archive so the switcher/management table shows it right away.
  const refreshStores = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const { data } = await cachedGet('/stores', undefined, { force });
      setStores(data.data);
      setCurrentStoreIdState((prev) => {
        const stillValid = prev && data.data.some((s) => s.id === prev && s.is_active);
        if (stillValid) return prev;
        const main = data.data.find((s) => s.is_main);
        const fallback = main?.id || null;
        persistCurrentStoreId(fallback);
        return fallback;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setStores([]);
      return;
    }
    if (isAdmin) {
      refreshStores();
    } else {
      setStores([]);
      persistCurrentStoreId(user.storeId);
      setCurrentStoreIdState(user.storeId);
    }
  }, [user, isAdmin, refreshStores]);

  const setCurrentStoreId = (storeId) => {
    if (!isAdmin) return;
    persistCurrentStoreId(storeId);
    setCurrentStoreIdState(storeId);
  };

  const currentStore = stores.find((s) => s.id === currentStoreId) || null;

  return (
    <StoreContext.Provider
      value={{ stores, currentStoreId, currentStore, setCurrentStoreId, refreshStores, loading, isAdmin }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export const useStore = () => useContext(StoreContext);
