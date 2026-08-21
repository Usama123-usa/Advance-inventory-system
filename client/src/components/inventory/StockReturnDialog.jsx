import { useEffect, useState } from 'react';
import { Plus, Trash2, Search, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/Textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';

// Lets the user pick any number of products for a single Stock Return
// transaction, each with its own return quantity, then saves them all in
// one POST /api/inventory/stock-return call (atomic on the backend).
export function StockReturnDialog({ open, onOpenChange, onSuccess }) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const [items, setItems] = useState([]); // [{ id, name, unit, quantity }]
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setResults([]);
      setItems([]);
      setReason('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSearching(true);
    api
      .get('/inventory/current', { params: { search: debouncedSearch, limit: 20 } })
      .then(({ data }) => setResults(data.data))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, [open, debouncedSearch]);

  const addProduct = (product) => {
    setItems((prev) =>
      prev.some((i) => i.id === product.id) ? prev : [...prev, { id: product.id, name: product.name, unit: product.unit, quantity: '1' }]
    );
  };

  const removeProduct = (id) => setItems((prev) => prev.filter((i) => i.id !== id));

  const updateQuantity = (id, value) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantity: value } : i)));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (items.length === 0) {
      toast.error('Select at least one product to return');
      return;
    }
    const invalid = items.some((i) => !i.quantity || Number(i.quantity) <= 0);
    if (invalid) {
      toast.error('Enter a quantity greater than 0 for every product');
      return;
    }

    setSaving(true);
    try {
      await api.post('/inventory/stock-return', {
        reason: reason.trim() || undefined,
        items: items.map((i) => ({ productId: i.id, quantity: Number(i.quantity) })),
      });
      toast.success('Stock return saved — inventory updated');
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

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Find products to return</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search products..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border">
              {searching ? (
                <p className="p-3 text-sm text-muted-foreground">Searching...</p>
              ) : results.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No products found</p>
              ) : (
                results.map((p) => {
                  const added = items.some((i) => i.id === p.id);
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => addProduct(p)}
                      disabled={added}
                      className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        {p.quantity} {p.unit} in stock
                        {added ? <span className="font-medium text-primary">Added</span> : <Plus className="h-3.5 w-3.5" />}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Products being returned ({items.length})</Label>
            {items.length === 0 ? (
              <EmptyState title="No products selected" description="Search above and add each product being returned." className="py-8" />
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Product</th>
                      <th className="px-3 py-2 text-left font-medium">Unit</th>
                      <th className="px-3 py-2 text-left font-medium">Quantity</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id} className="border-t border-border">
                        <td className="max-w-[10rem] truncate px-3 py-2">{i.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{i.unit}</td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min="1"
                            step="1"
                            required
                            value={i.quantity}
                            onChange={(e) => updateQuantity(i.id, e.target.value)}
                            className="h-8 w-24"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" onClick={() => removeProduct(i.id)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Reason (optional)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Damaged / customer return" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="success" loading={saving} disabled={items.length === 0}>
              Save Stock Return
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
