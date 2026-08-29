// Shared cart pricing math — used by both CartItemRow (per-line display)
// and POS (cart subtotal + the payload sent to the backend), so the three
// can never drift apart from each other.
//
// Tiles-only formula: Total = (Square Meter ÷ Units Per Box) × Quantity × Price.
// Every other category keeps the plain Quantity × Price it always had.
// A missing/zero packing_per_box on a tile product would divide by zero, so
// that case safely falls back to the plain Quantity × Price calculation
// instead of throwing or showing NaN.
//
// create_sale() on the backend applies this exact same formula (from the
// product's own stored square_meter/packing_per_box) to the raw price the
// cashier types in — so the frontend here only needs to mirror it for the
// live cart preview; the raw, unmodified price is what actually gets sent
// to the server as unitPrice.
export function getCartLineTotal(item) {
  const price = Number(item.price) || 0;
  const qty = Number(item.qty) || 0;
  const isTiles = item.product_type === 'tiles';
  const squareMeter = Number(item.square_meter) || 0;
  const perBox = Number(item.packing_per_box) || 0;

  if (isTiles && perBox > 0) {
    return (squareMeter / perBox) * qty * price;
  }
  return price * qty;
}

// Tiles-only: Total Boxes = Total Units ÷ Units Per Box (e.g. 100 units at
// 8/box → 12.5 boxes). Returns null for non-tile products, or when the
// product has no valid packing_per_box set (also guards divide-by-zero).
export function getTileBoxCount(product) {
  if (!product || product.product_type !== 'tiles') return null;
  const perBox = Number(product.packing_per_box) || 0;
  if (perBox <= 0) return null;
  const qty = Number(product.quantity) || 0;
  return qty / perBox;
}

// Trims to at most 2 decimal places without trailing zeros (12 → "12",
// 12.5 → "12.5", 12.567 → "12.57").
export function formatBoxCount(boxes) {
  if (boxes === null || boxes === undefined || !Number.isFinite(boxes)) return '—';
  return Number(boxes.toFixed(2)).toString();
}
