import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
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

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/settings');
      if (data.data) setSettings(data.data);
    } catch {
      // fall back to defaults silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) refresh();
    else setLoading(false);
  }, [user, refresh]);

  return (
    <SettingsContext.Provider value={{ settings, loading, refresh }}>{children}</SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
