import { useEffect, useState } from 'react';
import { Search, Undo2, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useSettings } from '@/context/SettingsContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/Textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency, formatDateTime } from '@/lib/utils';

// Sales-section Stock Return: search an invoice by number, pick it, then
// return any number of units (up to what's still on that line) for any of
// its products. Mirrors the invoice-agnostic
// client/src/components/inventory/StockReturnDialog.jsx pattern, but scoped
// to one sale's line items via POST /api/sales/:id/return instead of a
// standalone product+quantity list.
export function SalesReturnDialog({ open, onOpenChange, onSuccess, initialSaleId = null }) {
  const { settings } = useSettings();
  const currency = settings?.currency || 'PKR';

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);

  const [selectedSale, setSelectedSale] = useState(null);
  const [loadingSale, setLoadingSale] = useState(false);
  const [returnQtys, setReturnQtys] = useState({}); // { [saleItemId]: string }
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setMatches([]);
      setSelectedSale(null);
      setReturnQtys({});
      setReason('');
      return;
    }
    if (initialSaleId) loadSale(initialSaleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSaleId]);

  useEffect(() => {
    if (!open || selectedSale || initialSaleId) return;
    setSearching(true);
    api
      .get('/sales', { params: { search: debouncedSearch, limit: 10 } })
      .then(({ data }) => setMatches(data.data))
      .catch(() => setMatches([]))
      .finally(() => setSearching(false));
  }, [open, selectedSale, initialSaleId, debouncedSearch]);

  const loadSale = async (id) => {
    setLoadingSale(true);
    try {
      const { data } = await api.get(`/sales/${id}`);
      setSelectedSale(data.data);
      setReturnQtys({});
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoadingSale(false);
    }
  };

  const backToSearch = () => {
    setSelectedSale(null);
    setReturnQtys({});
  };

  const updateQty = (itemId, value) => setReturnQtys((prev) => ({ ...prev, [itemId]: value }));

  const returnItems = selectedSale
    ? Object.entries(returnQtys)
        .map(([saleItemId, qty]) => ({ saleItemId, quantity: Number(qty) }))
        .filter((i) => i.quantity > 0)
    : [];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedSale) return;

    if (returnItems.length === 0) {
      toast.error('Enter a return quantity for at least one product');
      return;
    }

    const overLimit = returnItems.find((i) => {
      const line = selectedSale.items.find((it) => it.id === i.saleItemId);
      return !line || i.quantity > line.quantity;
    });
    if (overLimit) {
      toast.error('Return quantity cannot exceed the quantity still on the invoice');
      return;
    }

    setSaving(true);
    try {
      await api.post(`/sales/${selectedSale.id}/return`, {
        items: returnItems,
        reason: reason.trim() || undefined,
      });
      toast.success('Stock return saved — invoice and inventory updated');
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-5 w-5" /> Stock Return
          </DialogTitle>
        </DialogHeader>

        {!selectedSale ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Find invoice by number</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search invoice number..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
              {searching ? (
                <p className="p-3 text-sm text-muted-foreground">Searching...</p>
              ) : matches.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No invoices found</p>
              ) : (
                matches.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => loadSale(s.id)}
                    className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-secondary"
                  >
                    <div>
                      <p className="font-medium">{s.invoice_number}</p>
                      <p className="text-xs text-muted-foreground">{s.customer_name || 'Walk-in Customer'} · {formatDateTime(s.created_at)}</p>
                    </div>
                    <span className="shrink-0 font-semibold text-primary">{formatCurrency(s.grand_total, currency)}</span>
                  </button>
                ))
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-secondary/40 p-3">
              <div>
                {!initialSaleId && (
                  <button
                    type="button"
                    onClick={backToSearch}
                    className="mb-1 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <ArrowLeft className="h-3 w-3" /> Choose a different invoice
                  </button>
                )}
                <p className="font-semibold">{selectedSale.invoice_number}</p>
                <p className="text-xs text-muted-foreground">
                  {selectedSale.customer_name || 'Walk-in Customer'} · {formatDateTime(selectedSale.created_at)}
                </p>
              </div>
              <span className="shrink-0 font-semibold text-primary">{formatCurrency(selectedSale.grand_total, currency)}</span>
            </div>

            {loadingSale ? (
              <p className="p-3 text-sm text-muted-foreground">Loading invoice...</p>
            ) : selectedSale.items.length === 0 ? (
              <EmptyState title="No products on this invoice" className="py-8" />
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Product</th>
                      <th className="px-3 py-2 text-right font-medium">Qty Sold</th>
                      <th className="px-3 py-2 text-right font-medium">Unit Price</th>
                      <th className="px-3 py-2 text-right font-medium">Total</th>
                      <th className="px-3 py-2 text-left font-medium">Return Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSale.items.map((item) => (
                      <tr key={item.id} className="border-t border-border">
                        <td className="max-w-[10rem] truncate px-3 py-2">{item.product_name}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{item.quantity}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{formatCurrency(item.unit_price, currency)}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(item.total, currency)}</td>
                        <td className="px-3 py-2">
                          {item.quantity > 0 ? (
                            <Input
                              type="number"
                              min="0"
                              max={item.quantity}
                              step="1"
                              value={returnQtys[item.id] || ''}
                              onChange={(e) => updateQty(item.id, e.target.value)}
                              className="h-8 w-24"
                              placeholder="0"
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">Fully returned</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Reason (optional)</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Damaged / customer return" />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" variant="success" loading={saving} disabled={loadingSale || returnItems.length === 0}>
                Save Stock Return
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
