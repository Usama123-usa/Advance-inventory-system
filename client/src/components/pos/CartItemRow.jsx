import { memo } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { formatCurrency, cn } from '@/lib/utils';

// onIncrease/onDecrease/onRemove/onPriceChange receive the item id — callers
// pass stable (useCallback) handlers so unrelated rows skip re-rendering via
// memo below.
function CartItemRowBase({ item, currency, onIncrease, onDecrease, onRemove, onPriceChange }) {
  const isTiles = item.product_type === 'tiles';
  const subtitle = isTiles
    ? [item.size, item.glaze_grade].filter(Boolean).join(' · ')
    : [item.company, item.article].filter(Boolean).join(' · ');
  const suggestedPrice = isTiles && item.sqr_meter && item.rate_per_meter
    ? Number(item.sqr_meter) * Number(item.rate_per_meter)
    : null;
  const lineTotal = (Number(item.price) || 0) * item.qty;

  return (
    <div className="flex flex-wrap items-center gap-4 py-5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-medium">{item.name}</p>
        {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
        <p className="text-xs text-muted-foreground">per {item.unit}</p>
        {suggestedPrice != null && (
          <p className="text-xs text-muted-foreground">Suggested: {formatCurrency(suggestedPrice, currency)}</p>
        )}
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border">
        <button onClick={() => onDecrease(item.id)} className="flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground">
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-7 text-center text-base font-medium">{item.qty}</span>
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
      </div>

      <p className="w-28 shrink-0 text-right text-base font-semibold">{formatCurrency(lineTotal, currency)}</p>
      <button onClick={() => onRemove(item.id)} className="text-muted-foreground hover:text-destructive">
        <Trash2 className="h-5 w-5" />
      </button>
    </div>
  );
}

export const CartItemRow = memo(CartItemRowBase);
