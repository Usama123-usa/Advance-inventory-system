import { memo } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

// onIncrease/onDecrease/onRemove receive the item id — callers pass stable
// (useCallback) handlers so unrelated rows skip re-rendering via memo below.
function CartItemRowBase({ item, currency, onIncrease, onDecrease, onRemove }) {
  const isTiles = item.product_type === 'tiles';
  const subtitle = isTiles
    ? [item.size, item.glaze_grade].filter(Boolean).join(' · ')
    : [item.company, item.article].filter(Boolean).join(' · ');

  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.name}</p>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        <p className="text-xs text-muted-foreground">{formatCurrency(item.selling_price, currency)} / {item.unit}</p>
      </div>
      <div className="flex items-center gap-1.5 rounded-lg border border-border">
        <button onClick={() => onDecrease(item.id)} className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground">
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="w-6 text-center text-sm font-medium">{item.qty}</span>
        <button onClick={() => onIncrease(item.id)} className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="w-20 shrink-0 text-right text-sm font-semibold">{formatCurrency(item.selling_price * item.qty, currency)}</p>
      <button onClick={() => onRemove(item.id)} className="text-muted-foreground hover:text-destructive">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export const CartItemRow = memo(CartItemRowBase);
