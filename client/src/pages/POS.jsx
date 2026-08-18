import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ScanBarcode, ShoppingCart, Trash2, Banknote, CreditCard, Landmark, Hash } from 'lucide-react';
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
import { Pagination } from '@/components/ui/Pagination';
import { ProductCard } from '@/components/pos/ProductCard';
import { CartItemRow } from '@/components/pos/CartItemRow';
import { formatCurrency, cn } from '@/lib/utils';

const PAGE_SIZE = 24;

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'bank_transfer', label: 'Bank Transfer', icon: Landmark },
];

export default function POS() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const currency = settings?.currency || 'PKR';

  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [barcode, setBarcode] = useState('');
  const barcodeRef = useRef(null);

  const [cart, setCart] = useState([]);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('walk-in');
  const [discount, setDiscount] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [completing, setCompleting] = useState(false);

  // Customer info + amount paid are optional for a full payment — they only
  // matter for tracking a partial payment's remaining balance.
  const [amountPaid, setAmountPaid] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');

  const taxRate = Number(settings?.tax_rate || 0);

  useEffect(() => {
    api.get('/customers', { params: { limit: 200 } }).then(({ data }) => setCustomers(data.data));
  }, []);

  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const { data } = await api.get('/products', {
        params: { search: debouncedSearch, status: 'active', page, limit: PAGE_SIZE },
      });
      setProducts(data.data);
      setPagination(data.pagination);
    } finally {
      setLoadingProducts(false);
    }
  }, [debouncedSearch, page]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);
  useEffect(() => setPage(1), [debouncedSearch]);

  const addToCart = useCallback((product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id);
      if (existing) {
        if (existing.qty >= product.quantity) {
          toast.error('No more stock available for this product');
          return prev;
        }
        return prev.map((i) => (i.id === product.id ? { ...i, qty: i.qty + 1 } : i));
      }
      // Pricing is still cashier-editable at sale time (create_sale() always
      // bills the typed unitPrice, never the catalog price), but the field
      // should start from the product's actual price instead of blank/0 —
      // tiles price from sqr_meter x rate_per_meter, everything else from
      // the stored selling_price when one is set.
      const defaultPrice =
        product.product_type === 'tiles' && product.sqr_meter && product.rate_per_meter
          ? Number(product.sqr_meter) * Number(product.rate_per_meter)
          : Number(product.selling_price) > 0
            ? Number(product.selling_price)
            : '';
      return [...prev, { ...product, qty: 1, price: defaultPrice === '' ? '' : String(defaultPrice) }];
    });
  }, []);

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

  const updateQty = useCallback((productId, delta) => {
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
  }, []);

  const increaseQty = useCallback((productId) => updateQty(productId, 1), [updateQty]);
  const decreaseQty = useCallback((productId) => updateQty(productId, -1), [updateQty]);

  // Manual qty entry — always receives a clean positive integer (the input
  // itself buffers in-progress typing locally), clamped to available stock.
  const setQtyDirect = useCallback((productId, qty) => {
    setCart((prev) =>
      prev.map((i) => {
        if (i.id !== productId) return i;
        if (qty > i.quantity) {
          toast.error('No more stock available');
          return { ...i, qty: i.quantity };
        }
        return { ...i, qty };
      })
    );
  }, []);

  const updatePrice = useCallback((productId, value) => {
    setCart((prev) => prev.map((i) => (i.id === productId ? { ...i, price: value } : i)));
  }, []);

  const removeFromCart = useCallback((productId) => setCart((prev) => prev.filter((i) => i.id !== productId)), []);

  const { subtotal, discountAmount, taxAmount, grandTotal } = useMemo(() => {
    const sub = cart.reduce((sum, i) => sum + (Number(i.price) || 0) * i.qty, 0);
    // A negative discount must never raise the total, so it's clamped here
    // in addition to being stripped from the input as the user types.
    const discountAmt = Math.max(Number(discount) || 0, 0);
    const taxable = Math.max(sub - discountAmt, 0);
    const tax = Number(((taxable * taxRate) / 100).toFixed(2));
    const grand = Number((taxable + tax).toFixed(2));
    return { subtotal: sub, discountAmount: discountAmt, taxAmount: tax, grandTotal: grand };
  }, [cart, discount, taxRate]);

  // Blank "Amount Paid" means paid in full — the backend defaults to that
  // when paidAmount is omitted, this is just the matching UI preview.
  const paidAmountValue = amountPaid === '' ? grandTotal : Math.min(Math.max(Number(amountPaid) || 0, 0), grandTotal);
  const remainingBalance = Math.max(grandTotal - paidAmountValue, 0);
  const paymentStatusPreview = remainingBalance <= 0 ? 'paid' : paidAmountValue <= 0 ? 'unpaid' : 'partial';

  const handleCustomerSelect = (value) => {
    setCustomerId(value);
    if (value === 'walk-in') return;
    const selected = customers.find((c) => c.id === value);
    if (selected) {
      setCustomerName(selected.name || '');
      setCustomerPhone(selected.phone || '');
      setCustomerAddress(selected.address || '');
    }
  };

  const resetCheckoutFields = () => {
    setCart([]);
    setInvoiceNumber('');
    setDiscount('0');
    setAmountPaid('');
    setCustomerId('walk-in');
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
  };

  const handleCompleteSale = async () => {
    if (cart.length === 0) {
      toast.error('Add at least one product to the cart');
      return;
    }
    if (!invoiceNumber.trim()) {
      toast.error('Enter an invoice number before completing the sale');
      return;
    }
    if (cart.some((i) => i.price === '' || i.price == null || Number(i.price) < 0)) {
      toast.error('Enter a selling price for every item in the cart');
      return;
    }
    if (remainingBalance > 0 && (!customerName.trim() || !customerPhone.trim())) {
      toast.error('Customer name and phone are required for a partial or unpaid sale, so this debt can be traced back to them');
      return;
    }
    setCompleting(true);
    try {
      const { data } = await api.post('/sales', {
        invoiceNumber: invoiceNumber.trim(),
        customerId: customerId === 'walk-in' ? null : customerId,
        items: cart.map((i) => ({ productId: i.id, quantity: i.qty, unitPrice: Number(i.price) })),
        discount: discountAmount,
        paymentMethod,
        paidAmount: amountPaid === '' ? undefined : Number(amountPaid),
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        customerAddress: customerAddress.trim() || undefined,
      });
      toast.success('Sale completed successfully');
      resetCheckoutFields();
      navigate(`/invoice/${data.data.id}`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="grid h-full grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Left: search + product grid */}
      <div className="space-y-4">
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
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-56" />)}
            </div>
          ) : products.length === 0 ? (
            <EmptyState title="No products found" description="Try a different search term." />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {products.map((p) => (
                  <ProductCard key={p.id} product={p} currency={currency} onClick={addToCart} />
                ))}
              </div>
              <Pagination page={page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} />
            </>
          )}
        </Card>
      </div>

      {/* Right: cart */}
      <Card className="flex h-fit flex-col lg:sticky lg:top-20">
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ShoppingCart className="h-5 w-5" /> Cart ({cart.length})
          </h2>
          {cart.length > 0 && (
            <button onClick={() => setCart([])} className="text-xs text-muted-foreground hover:text-destructive">
              Clear all
            </button>
          )}
        </div>

        {cart.length > 0 && (
          <div className="border-b border-border p-5 pb-0">
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Hash className="h-3.5 w-3.5" /> Invoice Number <span className="text-destructive">*</span>
            </label>
            <Input
              placeholder="Enter your invoice number"
              maxLength={40}
              required
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              className="mb-5 font-semibold"
            />
          </div>
        )}

        <div className="max-h-[46rem] min-h-[14rem] flex-1 divide-y divide-border overflow-y-auto px-5">
          {cart.length === 0 ? (
            <EmptyState icon={ShoppingCart} title="Cart is empty" description="Click a product to add it here." className="py-14" />
          ) : (
            cart.map((item) => (
              <CartItemRow
                key={item.id}
                item={item}
                currency={currency}
                onIncrease={increaseQty}
                onDecrease={decreaseQty}
                onQtyChange={setQtyDirect}
                onRemove={removeFromCart}
                onPriceChange={updatePrice}
              />
            ))
          )}
        </div>

        <div className="space-y-3 border-t border-border p-5">
          <Select value={customerId} onValueChange={handleCustomerSelect}>
            <SelectTrigger><SelectValue placeholder="Customer" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="walk-in">Walk-in Customer</SelectItem>
              {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className={cn('space-y-2 rounded-lg border p-3', remainingBalance > 0 ? 'border-destructive/40' : 'border-border')}>
            <p className="text-xs font-medium text-muted-foreground">
              Customer info{' '}
              <span className={cn('font-normal', remainingBalance > 0 && 'text-destructive')}>
                {remainingBalance > 0 ? '(required — this sale has a remaining balance)' : '(optional — only needed for partial payment tracking)'}
              </span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Name" required={remainingBalance > 0} className="h-8 text-xs" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              <Input placeholder="Phone" required={remainingBalance > 0} className="h-8 text-xs" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
              <Input placeholder="Address" className="h-8 text-xs col-span-2" value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
            </div>
          </div>

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
                onChange={(e) => setDiscount(e.target.value.replace('-', ''))}
                className="h-7 w-24 text-right"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Tax ({taxRate}%)</span>
              <span>{formatCurrency(taxAmount, currency)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between rounded-lg bg-primary/5 px-3 py-2.5 text-base font-bold">
              <span>Grand Total</span>
              <span className="text-lg text-primary">{formatCurrency(grandTotal, currency)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Amount Paid</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder={grandTotal.toFixed(2)}
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                className="h-7 w-24 text-right"
              />
            </div>
            {remainingBalance > 0 && (
              <div className="flex items-center justify-between rounded-md bg-destructive/10 px-2 py-1.5 text-destructive">
                <span className="text-xs font-medium">Remaining Balance</span>
                <span className="text-sm font-bold">{formatCurrency(remainingBalance, currency)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Payment Status</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 font-medium capitalize',
                  paymentStatusPreview === 'paid' && 'bg-success/10 text-success',
                  paymentStatusPreview === 'partial' && 'bg-warning/10 text-warning',
                  paymentStatusPreview === 'unpaid' && 'bg-destructive/10 text-destructive'
                )}
              >
                {paymentStatusPreview}
              </span>
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

          <Button variant="success" className="w-full" size="lg" loading={completing} onClick={handleCompleteSale} disabled={cart.length === 0}>
            Complete Sale
          </Button>
        </div>
      </Card>
    </div>
  );
}
