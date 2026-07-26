import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ScanBarcode, ShoppingCart, Trash2, Banknote, CreditCard, Landmark } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useSettings } from '@/context/SettingsContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ProductCard } from '@/components/pos/ProductCard';
import { CartItemRow } from '@/components/pos/CartItemRow';
import { formatCurrency, cn } from '@/lib/utils';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'bank_transfer', label: 'Bank Transfer', icon: Landmark },
];

export default function POS() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const currency = settings?.currency || 'USD';

  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [barcode, setBarcode] = useState('');
  const barcodeRef = useRef(null);

  const [cart, setCart] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('walk-in');
  const [discount, setDiscount] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [completing, setCompleting] = useState(false);

  const taxRate = Number(settings?.tax_rate || 0);

  useEffect(() => {
    api.get('/customers', { params: { limit: 200 } }).then(({ data }) => setCustomers(data.data));
  }, []);

  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const { data } = await api.get('/products', {
        params: { search: debouncedSearch, status: 'active', limit: 24 },
      });
      setProducts(data.data);
    } finally {
      setLoadingProducts(false);
    }
  }, [debouncedSearch]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const addToCart = (product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id);
      if (existing) {
        if (existing.qty >= product.quantity) {
          toast.error('No more stock available for this product');
          return prev;
        }
        return prev.map((i) => (i.id === product.id ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...prev, { ...product, qty: 1 }];
    });
  };

  const handleBarcodeSearch = async (e) => {
    e.preventDefault();
    if (!barcode.trim()) return;
    try {
      const { data } = await api.get(`/products/barcode/${encodeURIComponent(barcode.trim())}`);
      addToCart(data.data);
      setBarcode('');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const updateQty = (productId, delta) => {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.id !== productId) return i;
          const newQty = i.qty + delta;
          if (newQty > i.quantity) {
            toast.error('No more stock available');
            return i;
          }
          return { ...i, qty: newQty };
        })
        .filter((i) => i.qty > 0)
    );
  };

  const removeFromCart = (productId) => setCart((prev) => prev.filter((i) => i.id !== productId));

  const subtotal = cart.reduce((sum, i) => sum + i.selling_price * i.qty, 0);
  const discountAmount = Number(discount) || 0;
  const taxableAmount = Math.max(subtotal - discountAmount, 0);
  const taxAmount = Number(((taxableAmount * taxRate) / 100).toFixed(2));
  const grandTotal = Number((taxableAmount + taxAmount).toFixed(2));

  const handleCompleteSale = async () => {
    if (cart.length === 0) {
      toast.error('Add at least one product to the cart');
      return;
    }
    setCompleting(true);
    try {
      const { data } = await api.post('/sales', {
        customerId: customerId === 'walk-in' ? null : customerId,
        items: cart.map((i) => ({ productId: i.id, quantity: i.qty })),
        discount: discountAmount,
        paymentMethod,
      });
      toast.success('Sale completed successfully');
      setCart([]);
      setDiscount('0');
      navigate(`/invoice/${data.data.id}`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="grid h-full grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Left: search + product grid */}
      <div className="space-y-4 lg:col-span-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search products..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <form onSubmit={handleBarcodeSearch} className="relative">
            <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={barcodeRef}
              placeholder="Scan or enter barcode + Enter"
              className="pl-9"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
            />
          </form>
        </div>

        <Card className="p-4">
          {loadingProducts ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
            </div>
          ) : products.length === 0 ? (
            <EmptyState title="No products found" description="Try a different search term." />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} currency={currency} onClick={addToCart} />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Right: cart */}
      <Card className="flex h-fit flex-col lg:sticky lg:top-20">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <ShoppingCart className="h-4 w-4" /> Cart ({cart.length})
          </h2>
          {cart.length > 0 && (
            <button onClick={() => setCart([])} className="text-xs text-muted-foreground hover:text-destructive">
              Clear all
            </button>
          )}
        </div>

        <div className="max-h-80 flex-1 divide-y divide-border overflow-y-auto px-4">
          {cart.length === 0 ? (
            <EmptyState icon={ShoppingCart} title="Cart is empty" description="Click a product to add it here." className="py-10" />
          ) : (
            cart.map((item) => (
              <CartItemRow
                key={item.id}
                item={item}
                currency={currency}
                onIncrease={() => updateQty(item.id, 1)}
                onDecrease={() => updateQty(item.id, -1)}
                onRemove={() => removeFromCart(item.id)}
              />
            ))
          )}
        </div>

        <div className="space-y-3 border-t border-border p-4">
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger><SelectValue placeholder="Customer" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="walk-in">Walk-in Customer</SelectItem>
              {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(subtotal, currency)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Discount</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                className="h-7 w-24 text-right"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Tax ({taxRate}%)</span>
              <span>{formatCurrency(taxAmount, currency)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2 text-base font-bold">
              <span>Grand Total</span>
              <span className="text-primary">{formatCurrency(grandTotal, currency)}</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {PAYMENT_METHODS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setPaymentMethod(value)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium transition-colors',
                  paymentMethod === value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-secondary'
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>

          <Button className="w-full" size="lg" loading={completing} onClick={handleCompleteSale} disabled={cart.length === 0}>
            Complete Sale
          </Button>
        </div>
      </Card>
    </div>
  );
}
