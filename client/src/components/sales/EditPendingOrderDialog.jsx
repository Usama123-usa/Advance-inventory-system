import { useEffect, useState } from 'react';
import { Search, Plus, Minus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useSettings } from '@/context/SettingsContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/Select';
import { getCartLineTotal, getRawUnitPrice } from '@/lib/pricing';
import { formatCurrency, cn } from '@/lib/utils';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
];

// Edit dialog for a Pending Order: products, quantities and prices are all
// editable (stock is reconciled server-side by update_pending_order()), plus
// the same order-level fields the POS cart collects. Prices always start
// blank when an item is loaded/added, mirroring POS.jsx's own cart
// behavior ("Pricing is always cashier-typed at sale time") — this sidesteps
// having to reverse the Tiles pricing formula out of the stored total.
export function EditPendingOrderDialog({ open, onOpenChange, saleId, onSuccess }) {
  const { settings } = useSettings();
  const currency = settings?.currency || 'PKR';
  const taxRate = Number(settings?.tax_rate || 0);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [items, setItems] = useState([]);
  const [discount, setDiscount] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [amountPaid, setAmountPaid] = useState('');
  const [saleDate, setSaleDate] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open || !saleId) return;
    setLoading(true);
    api
      .get(`/sales/${saleId}`)
      .then(({ data }) => {
        const sale = data.data;
        setItems(
          sale.items.map((it) => ({
            productId: it.product_id,
            name: it.product_name,
            product_type: it.product_type,
            packing_per_box: it.packing_per_box,
            square_meter: it.square_meter,
            qty: it.quantity,
            price: String(getRawUnitPrice(it)),
          }))
        );
        setDiscount(String(sale.discount ?? 0));
        setPaymentMethod(sale.payment_method || 'cash');
        setAmountPaid('');
        setSaleDate(sale.sale_date || '');
        setCustomerName(sale.customer_name || '');
        setCustomerPhone(sale.customer_phone || '');
        setCustomerAddress(sale.customer_address || '');
      })
      .catch((err) => toast.error(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [open, saleId]);

  useEffect(() => {
    if (!open || !debouncedSearch.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    api
      .get('/products', { params: { search: debouncedSearch, status: 'active', limit: 8 } })
      .then(({ data }) => setResults(data.data))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, [open, debouncedSearch]);

  const addProduct = (product) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        return prev.map((i) => (i.productId === product.id ? { ...i, qty: i.qty + 1 } : i));
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          product_type: product.product_type,
          packing_per_box: product.packing_per_box,
          square_meter: product.square_meter,
          qty: 1,
          price: '',
        },
      ];
    });
    setSearch('');
    setResults([]);
  };

  const updateQty = (productId, delta) => {
    setItems((prev) =>
      prev.map((i) => (i.productId === productId ? { ...i, qty: Math.max(1, i.qty + delta) } : i)).filter((i) => i.qty > 0)
    );
  };

  const updatePrice = (productId, value) => {
    setItems((prev) => prev.map((i) => (i.productId === productId ? { ...i, price: value } : i)));
  };

  const removeItem = (productId) => setItems((prev) => prev.filter((i) => i.productId !== productId));

  const subtotal = items.reduce((sum, i) => sum + getCartLineTotal(i), 0);
  const discountAmount = Math.max(Number(discount) || 0, 0);
  const taxable = Math.max(subtotal - discountAmount, 0);
  const taxAmount = Number(((taxable * taxRate) / 100).toFixed(2));
  const grandTotal = Number((taxable + taxAmount).toFixed(2));
  const paidAmountValue = amountPaid === '' ? grandTotal : Math.min(Math.max(Number(amountPaid) || 0, 0), grandTotal);
  const remainingBalance = Math.max(grandTotal - paidAmountValue, 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (items.length === 0) {
      toast.error('Add at least one product');
      return;
    }
    if (items.some((i) => i.price === '' || i.price == null || Number(i.price) < 0)) {
      toast.error('Enter a selling price for every item');
      return;
    }
    if (remainingBalance > 0 && (!customerName.trim() || !customerPhone.trim())) {
      toast.error('Customer name and phone are required when the order has a remaining balance');
      return;
    }
    setSaving(true);
    try {
      await api.put(`/sales/${saleId}/pending`, {
        items: items.map((i) => ({ productId: i.productId, quantity: i.qty, unitPrice: Number(i.price) || 0 })),
        discount: discountAmount,
        paymentMethod,
        paidAmount: amountPaid === '' ? undefined : Number(amountPaid),
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        customerAddress: customerAddress.trim() || undefined,
        saleDate: saleDate || undefined,
      });
      toast.success('Pending order updated');
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
          <DialogTitle>Edit Pending Order</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="p-3 text-sm text-muted-foreground">Loading order...</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search products to add..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {(searching || results.length > 0) && (
                <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
                  {searching ? (
                    <p className="p-3 text-sm text-muted-foreground">Searching...</p>
                  ) : (
                    results.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => addProduct(p)}
                        className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-secondary"
                      >
                        <span className="truncate">{p.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{p.quantity} {p.unit} left</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
              {items.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No products on this order.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Product</th>
                      <th className="px-3 py-2 text-center font-medium">Qty</th>
                      <th className="px-3 py-2 text-right font-medium">Price</th>
                      <th className="px-3 py-2 text-right font-medium">Total</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.productId} className="border-t border-border">
                        <td className="max-w-[9rem] truncate px-3 py-2">{item.name}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center gap-1">
                            <button type="button" onClick={() => updateQty(item.productId, -1)} className="text-muted-foreground hover:text-foreground">
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="w-6 text-center">{item.qty}</span>
                            <button type="button" onClick={() => updateQty(item.productId, 1)} className="text-muted-foreground hover:text-foreground">
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={item.price}
                            onChange={(e) => updatePrice(item.productId, e.target.value)}
                            className={cn('h-8 w-24 text-right', (item.price === '' || item.price == null) && 'border-primary/40 bg-primary/5')}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">{formatCurrency(getCartLineTotal(item), currency)}</td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" onClick={() => removeItem(item.productId)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Discount</Label>
                <Input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value.replace('-', ''))} />
              </div>
              <div className="space-y-1.5">
                <Label>Sale Date</Label>
                <Input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Customer info{' '}
                <span className={cn(remainingBalance > 0 && 'text-destructive')}>
                  {remainingBalance > 0 ? '(required — this order has a remaining balance)' : '(optional)'}
                </span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Name" className="h-8 text-xs" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                <Input placeholder="Phone" className="h-8 text-xs" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
                <Input placeholder="Address" className="h-8 text-xs col-span-2" value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={`Amount paid (${grandTotal.toFixed(2)})`}
                  className="h-8 text-xs"
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(e.target.value)}
                />
                <div className="flex items-center justify-end text-xs text-muted-foreground">
                  Grand Total: <span className="ml-1 font-semibold text-foreground">{formatCurrency(grandTotal, currency)}</span>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" variant="success" loading={saving}>Save Changes</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
