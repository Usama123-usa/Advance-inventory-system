import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { cachedGet } from '@/lib/api';
import { useAuth } from './AuthContext';

const SettingsContext = createContext(null);

const DEFAULT_SETTINGS = {
  shop_name: 'My Shop',
  currency: 'PKR',
  tax_rate: 0,
  invoice_footer: 'Thank you for your business!',
  address: '',
  phone: '',
  email: '',
  logo_url: null,
};

export function SettingsProvider({ children }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  // Cached for 5 minutes on the passive initial load; explicit refresh()
  // calls (e.g. after saving Settings) always force a fresh fetch.
  const load = useCallback(async (force = false) => {
    try {
      const { data } = await cachedGet('/settings', undefined, { force });
      if (data.data) setSettings(data.data);
    } catch {
      // fall back to defaults silently
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    if (user) load(false);
    else setLoading(false);
  }, [user, load]);

  return (
    <SettingsContext.Provider value={{ settings, loading, refresh }}>{children}</SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
