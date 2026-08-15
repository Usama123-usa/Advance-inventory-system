import { memo } from 'react';
import { Package } from 'lucide-react';

function ProductCardBase({ product, onClick }) {
  const outOfStock = product.quantity <= 0;
  const isTiles = product.product_type === 'tiles';
  const subtitle = isTiles
    ? [product.size, product.glaze_grade].filter(Boolean).join(' · ')
    : [product.company, product.article].filter(Boolean).join(' · ');
  const rateLabel = isTiles && product.sqr_meter && product.rate_per_meter
    ? `${product.sqr_meter} m² × rate/m²`
    : null;

  return (
    <button
      type="button"
      disabled={outOfStock}
      onClick={() => onClick(product)}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-40"
    >
      <div className="flex h-24 w-full items-center justify-center bg-secondary text-muted-foreground">
        <Package className="h-9 w-9" />
      </div>
      <div className="p-4">
        <p className="truncate text-base font-medium">{product.name}</p>
        {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-sm font-medium text-primary">{outOfStock ? 'Out of stock' : 'Tap to add'}</span>
          <span className="text-xs text-muted-foreground">{outOfStock ? '' : `${product.quantity} ${product.unit} left`}</span>
        </div>
        {rateLabel && <p className="mt-0.5 text-xs text-muted-foreground">{rateLabel}</p>}
      </div>
    </button>
  );
}

export const ProductCard = memo(ProductCardBase);
