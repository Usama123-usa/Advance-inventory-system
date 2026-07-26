import { Package } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export function ProductCard({ product, currency, onClick }) {
  const outOfStock = product.quantity <= 0;

  return (
    <button
      type="button"
      disabled={outOfStock}
      onClick={() => onClick(product)}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-40"
    >
      <div className="aspect-square w-full overflow-hidden bg-secondary">
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Package className="h-8 w-8" />
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-medium">{product.name}</p>
        <div className="mt-1 flex items-center justify-between">
          <p className="text-sm font-semibold text-primary">{formatCurrency(product.selling_price, currency)}</p>
          <span className="text-xs text-muted-foreground">{outOfStock ? 'Out of stock' : `${product.quantity} left`}</span>
        </div>
      </div>
    </button>
  );
}
