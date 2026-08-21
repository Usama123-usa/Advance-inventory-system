import { memo } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TableRow, TableCell } from '@/components/ui/Table';

// Row-based product list for POS (Product | Stock | Select) — replaces the
// old image-card grid. Still just forwards a click straight into the same
// addToCart(product) handler POS.jsx already wires up.
function ProductRowBase({ product, onClick }) {
  const outOfStock = product.quantity <= 0;
  const isTiles = product.product_type === 'tiles';
  const subtitle = isTiles
    ? [product.size, product.glaze_grade].filter(Boolean).join(' · ')
    : [product.company, product.article].filter(Boolean).join(' · ');

  return (
    <TableRow className={outOfStock ? 'opacity-60' : ''}>
      <TableCell>
        <p className="truncate font-medium">{product.name}</p>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {outOfStock ? <span className="text-destructive font-medium">Out of stock</span> : `${product.quantity} ${product.unit} left`}
      </TableCell>
      <TableCell className="text-right">
        <Button type="button" size="sm" disabled={outOfStock} onClick={() => onClick(product)}>
          <Plus className="h-3.5 w-3.5" /> Select
        </Button>
      </TableCell>
    </TableRow>
  );
}

export const ProductRow = memo(ProductRowBase);
