import { memo } from 'react';
import { Package } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

function ProductCardBase({ product, currency, onClick }) {
  const outOfStock = product.quantity <= 0;
  const isTiles = product.product_type === 'tiles';
  const subtitle = isTiles
    ? [product.size, product.glaze_grade].filter(Boolean).join(' · ')
    : [product.company, product.article].filter(Boolean).join(' · ');
  const computedRate =
    isTiles && product.sqr_meter && product.rate_per_meter
      ? Number(product.sqr_meter) * Number(product.rate_per_meter)
      : null;

  return (
    <button
      type="button"
      disabled={outOfStock}
      onClick={() => onClick(product)}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-40"
    >
      <div className="flex h-16 w-full items-center justify-center bg-secondary text-muted-foreground">
        <Package className="h-6 w-6" />
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-medium">{product.name}</p>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        <div className="mt-1 flex items-center justify-between">
          <p className="text-sm font-semibold text-primary">{formatCurrency(product.selling_price, currency)}</p>
          <span className="text-xs text-muted-foreground">{outOfStock ? 'Out of stock' : `${product.quantity} ${product.unit} left`}</span>
        </div>
        {computedRate != null && (
          <p className="text-[10px] text-muted-foreground">≈ {formatCurrency(computedRate, currency)} (sqm × rate)</p>
        )}
      </div>
    </button>
  );
}

export const ProductCard = memo(ProductCardBase);
