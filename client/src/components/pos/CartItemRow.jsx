import { memo, useEffect, useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { formatCurrency, cn } from '@/lib/utils';

// onIncrease/onDecrease/onQtyChange/onRemove/onPriceChange receive the item
// id — callers pass stable (useCallback) handlers so unrelated rows skip
// re-rendering via memo below.
function CartItemRowBase({ item, currency, onIncrease, onDecrease, onQtyChange, onRemove, onPriceChange }) {
  const isTiles = item.product_type === 'tiles';
  const subtitle = isTiles
    ? [item.size, item.glaze_grade].filter(Boolean).join(' · ')
    : [item.company, item.article].filter(Boolean).join(' · ');
  const lineTotal = (Number(item.price) || 0) * item.qty;

  // Buffers in-progress typing locally so the field can be cleared/retyped
  // freely; only pushes a valid positive integer up to the cart (which keeps
  // cart.qty always a clean number, never a stray string from a half-typed
  // value) — that's also what keeps the line/grand totals in sync live.
  const [qtyText, setQtyText] = useState(String(item.qty));
  useEffect(() => setQtyText(String(item.qty)), [item.qty]);

  const handleQtyInput = (e) => {
    const raw = e.target.value;
    setQtyText(raw);
    const parsed = Math.floor(Number(raw));
    if (raw !== '' && Number.isFinite(parsed) && parsed >= 1) {
      onQtyChange(item.id, parsed);
    }
  };

  const handleQtyBlur = () => {
    const parsed = Math.floor(Number(qtyText));
    if (qtyText === '' || !Number.isFinite(parsed) || parsed < 1) {
      setQtyText(String(item.qty));
    }
  };

  return (
    <div className="space-y-3 py-5">
      <div className="min-w-0">
        <p className="truncate text-base font-medium">{item.name}</p>
        {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 rounded-lg border border-border">
          <button onClick={() => onDecrease(item.id)} className="flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground">
            <Minus className="h-4 w-4" />
          </button>
          <input
            type="number"
            min="1"
            inputMode="numeric"
            value={qtyText}
            onChange={handleQtyInput}
            onBlur={handleQtyBlur}
            className="h-10 w-14 rounded border-0 bg-transparent text-center text-base font-medium focus:outline-none focus-visible:ring-1 focus-visible:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button onClick={() => onIncrease(item.id)} className="flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground">
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col items-end gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Price</span>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={item.price}
            onChange={(e) => onPriceChange(item.id, e.target.value)}
            className={cn(
              'h-10 w-28 text-right text-base font-semibold',
              item.price === '' || item.price == null
                ? 'border-primary/40 bg-primary/5'
                : 'border-primary/30'
            )}
          />
          <span className="text-xs text-muted-foreground">Total: {formatCurrency(lineTotal, currency)}</span>
        </div>
      </div>

      <button onClick={() => onRemove(item.id)} className="text-muted-foreground hover:text-destructive">
        <Trash2 className="h-5 w-5" />
      </button>
    </div>
  );
}

export const CartItemRow = memo(CartItemRowBase);
