import { useEffect, useState, useRef } from 'react';
import { Store, Save, Sun, Moon, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import { useSettings } from '@/context/SettingsContext';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/Textarea';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

export default function Settings() {
  const { settings, refresh } = useSettings();
  const { isAdmin } = useAuth();
  const { theme, setTheme } = useTheme();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (settings) {
      setForm({
        shopName: settings.shop_name || '',
        address: settings.address || '',
        phone: settings.phone || '',
        email: settings.email || '',
        currency: settings.currency || 'USD',
        taxRate: settings.tax_rate ?? 0,
        invoiceFooter: settings.invoice_footer || '',
      });
    }
  }, [settings]);

  if (!form) return null;

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/settings', form);
      toast.success('Settings updated successfully');
      refresh();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      await api.post('/settings/logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Logo updated');
      refresh();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setUploadingLogo(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Configure your store and system preferences" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Store Information</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-border bg-secondary">
                  {settings?.logo_url ? (
                    <img src={settings.logo_url} alt="Logo" className="h-full w-full object-cover" />
                  ) : (
                    <Store className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <Button type="button" variant="outline" size="sm" loading={uploadingLogo} onClick={() => fileInputRef.current?.click()} disabled={!isAdmin}>
                  <Upload className="h-4 w-4" /> Upload Logo
                </Button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              </div>

              <div className="space-y-1.5">
                <Label>Shop Name</Label>
                <Input disabled={!isAdmin} value={form.shopName} onChange={(e) => setForm({ ...form, shopName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Address</Label>
                <Textarea disabled={!isAdmin} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input disabled={!isAdmin} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input type="email" disabled={!isAdmin} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
              </div>

              {isAdmin && (
                <Button type="submit" variant="success" loading={saving}><Save className="h-4 w-4" /> Save Store Info</Button>
              )}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>System Settings</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Currency Code</Label>
                  <Input disabled={!isAdmin} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} placeholder="USD" maxLength={3} />
                </div>
                <div className="space-y-1.5">
                  <Label>Tax Rate (%)</Label>
                  <Input type="number" step="0.01" min="0" disabled={!isAdmin} value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Invoice Footer</Label>
                <Textarea disabled={!isAdmin} value={form.invoiceFooter} onChange={(e) => setForm({ ...form, invoiceFooter: e.target.value })} />
              </div>
              {isAdmin && (
                <Button type="submit" variant="success" loading={saving}><Save className="h-4 w-4" /> Save System Settings</Button>
              )}
            </form>

            <div className="border-t border-border pt-4">
              <Label className="mb-2 block">Theme</Label>
              <div className="flex gap-2">
                <button
                  onClick={() => setTheme('light')}
                  className={cn('flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium', theme === 'light' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}
                >
                  <Sun className="h-4 w-4" /> Light
                </button>
                <button
                  onClick={() => setTheme('dark')}
                  className={cn('flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium', theme === 'dark' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}
                >
                  <Moon className="h-4 w-4" /> Dark
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
