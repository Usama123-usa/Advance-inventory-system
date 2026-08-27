import { useEffect, useState, useCallback, memo } from 'react';
import { Plus, Search, Pencil, Trash2, Package, Filter } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/context/AuthContext';
import { useStore } from '@/context/StoreContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/Textarea';
import { Card } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/Select';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { Badge } from '@/components/ui/Badge';
import { TileOptionField } from '@/components/products/TileOptionField';

// Drives the Tiles form's 5 manual-entry fields, each backed by its own
// persisted, user-built option list (tile_field_options.field_name).
const TILE_OPTION_FIELDS = [
  { key: 'size', formKey: 'size', label: 'Size', type: 'text', placeholder: 'e.g. 30x30, 60x60' },
  { key: 'glaze_mate', formKey: 'glazeGrade', label: 'Glaze / Grade', type: 'text' },
  { key: 'sqr_meter', formKey: 'sqrMeter', label: 'SQR Meter per Box', type: 'number' },
  { key: 'packing_per_box', formKey: 'packingPerBox', label: 'Packing / Tiles per Box', type: 'number' },
  { key: 'rate_per_meter', formKey: 'ratePerMeter', label: 'Rate per Meter', type: 'number' },
  // Per-unit square meter used at POS time to compute
  // Total = Quantity × Price × Square Meter (see CartItemRow.jsx/POS.jsx).
  { key: 'square_meter', formKey: 'squareMeter', label: 'Square Meter (m²)', type: 'number' },
];

const emptyTileOptions = { size: [], glaze_mate: [], sqr_meter: [], packing_per_box: [], rate_per_meter: [], square_meter: [] };

const UNIT_OPTIONS = [
  { value: 'kg', label: 'Kg' },
  { value: 'gram', label: 'Gram' },
  { value: 'liter', label: 'Liter' },
  { value: 'piece', label: 'Piece' },
  { value: 'box', label: 'Box' },
  { value: 'dozen', label: 'Dozen' },
  { value: 'pcs', label: 'Pcs' },
];

const emptyForm = {
  name: '',
  categoryId: '',
  purchasePrice: '',
  quantity: '',
  lowStockThreshold: '5',
  description: '',
  status: 'active',
  storeIds: [],
  // Tiles form
  size: '',
  glazeGrade: '',
  sqrMeter: '',
  packingPerBox: '',
  ratePerMeter: '',
  squareMeter: '',
  // Other form
  article: '',
  company: '',
  unit: 'Pcs',
};

// Memoized row — with stable onEdit/onDeleteRequest callbacks from the
// parent, unrelated row updates (e.g. editing a different product) skip
// re-rendering every other row in the table.
const ProductRow = memo(function ProductRow({ product, isAdmin, canManageProducts, selected, onToggleSelect, onEdit, onDeleteRequest }) {
  return (
    <TableRow>
      {isAdmin && (
        <TableCell>
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border"
            checked={selected}
            onChange={() => onToggleSelect(product.id)}
            aria-label={`Select ${product.name}`}
          />
        </TableCell>
      )}
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground">
            <Package className="h-4 w-4" />
          </div>
          <span className="font-medium">{product.name}</span>
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{product.category_name || '—'}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {product.product_type === 'tiles'
          ? [product.size, product.glaze_grade].filter(Boolean).join(' · ') || '—'
          : [product.company, product.article].filter(Boolean).join(' · ') || '—'}
      </TableCell>
      <TableCell>
        <span className={product.quantity <= product.low_stock_threshold ? 'text-destructive font-semibold' : ''}>
          {product.quantity} {product.unit}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={product.status === 'active' ? 'success' : 'secondary'} className="capitalize">
          {product.status}
        </Badge>
      </TableCell>
      {canManageProducts && (
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" onClick={() => onEdit(product)}>
              <Pencil className="h-4 w-4 text-primary" />
            </Button>
            {isAdmin && (
              <Button variant="ghost" size="icon" onClick={() => onDeleteRequest(product)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </div>
        </TableCell>
      )}
    </TableRow>
  );
});

export default function Products() {
  const { isAdmin, isStoreManager } = useAuth();
  const canManageProducts = isAdmin || isStoreManager;
  const { stores, currentStore } = useStore();
  const activeStores = stores.filter((s) => s.is_active);

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tileOptions, setTileOptions] = useState(emptyTileOptions);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Plain (uncached) fetch — Categories.jsx writes are uncached too, and
  // since this page unmounts/remounts on every navigation, a freshly added
  // category always shows up here without needing a hard refresh.
  useEffect(() => {
    api.get('/categories', { params: { limit: 200 } }).then(({ data }) => setCategories(data.data));
  }, []);

  useEffect(() => {
    api.get('/tile-options').then(({ data }) => {
      const grouped = { ...emptyTileOptions };
      const seen = new Set();
      data.data.forEach((opt) => {
        // Dedupe by field + normalized value: the DB's unique index is
        // case-sensitive, so "60x60" and "60X60" (or stale pre-migration
        // rows) can both exist and would otherwise render as look-alike
        // duplicate entries in the dropdown.
        const dedupeKey = `${opt.field_name}:${opt.option_value.trim().toLowerCase()}`;
        if (!grouped[opt.field_name] || seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        grouped[opt.field_name].push(opt);
      });
      setTileOptions(grouped);
    }).catch(() => {});
  }, []);

  const addTileOption = async (fieldKey, value) => {
    try {
      const { data } = await api.post('/tile-options', { fieldName: fieldKey, value });
      setTileOptions((prev) => {
        const normalized = data.data.option_value.trim().toLowerCase();
        if (prev[fieldKey].some((o) => o.id === data.data.id || o.option_value.trim().toLowerCase() === normalized)) {
          return prev;
        }
        return {
          ...prev,
          [fieldKey]: [...prev[fieldKey], data.data].sort((a, b) => a.option_value.localeCompare(b.option_value)),
        };
      });
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const deleteTileOption = async (fieldKey, id) => {
    const previous = tileOptions[fieldKey];
    setTileOptions((prev) => ({ ...prev, [fieldKey]: prev[fieldKey].filter((o) => o.id !== id) }));
    try {
      await api.delete(`/tile-options/${id}`);
    } catch (err) {
      setTileOptions((prev) => ({ ...prev, [fieldKey]: previous }));
      toast.error(getErrorMessage(err));
    }
  };

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/products', {
        params: {
          search: debouncedSearch,
          category: categoryFilter === 'all' ? '' : categoryFilter,
          status: statusFilter === 'all' ? '' : statusFilter,
          page,
          limit: 20,
        },
      });
      setProducts(data.data);
      setPagination(data.pagination);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, categoryFilter, statusFilter, page]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => setPage(1), [debouncedSearch, categoryFilter, statusFilter]);

  useEffect(() => setSelectedIds(new Set()), [debouncedSearch, categoryFilter, statusFilter, page]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allOnPageSelected = products.length > 0 && products.every((p) => selectedIds.has(p.id));
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (allOnPageSelected) return new Set();
      const next = new Set(prev);
      products.forEach((p) => next.add(p.id));
      return next;
    });
  };

  const openCreate = () => {
    setEditing(null);
    // Every active store is selected by default — the product is assigned
    // to all of them unless the user manually deselects one.
    setForm({ ...emptyForm, storeIds: activeStores.map((s) => s.id) });
    setDialogOpen(true);
  };

  const openEdit = useCallback((product) => {
    setEditing(product);
    setForm({
      name: product.name,
      categoryId: product.category_id || '',
      purchasePrice: String(product.purchase_price),
      quantity: String(product.quantity),
      lowStockThreshold: String(product.low_stock_threshold),
      description: product.description || '',
      status: product.status,
      storeIds: [],
      size: product.size || '',
      glazeGrade: product.glaze_grade || '',
      sqrMeter: product.sqr_meter != null ? String(product.sqr_meter) : '',
      packingPerBox: product.packing_per_box != null ? String(product.packing_per_box) : '',
      ratePerMeter: product.rate_per_meter != null ? String(product.rate_per_meter) : '',
      squareMeter: product.square_meter != null ? String(product.square_meter) : '',
      article: product.article || '',
      company: product.company || '',
      unit: product.unit || 'pcs',
    });
    setDialogOpen(true);
  }, []);

  const handleDeleteRequest = useCallback((product) => setDeleteTarget(product), []);

  const activeCategory = categories.find((c) => c.id === form.categoryId);
  const activeType = activeCategory?.type || 'other';
  const isTilesForm = activeType === 'tiles';

  const toggleStoreId = (storeId) => {
    setForm((f) => ({
      ...f,
      storeIds: f.storeIds.includes(storeId) ? f.storeIds.filter((id) => id !== storeId) : [...f.storeIds, storeId],
    }));
  };

  const allActiveStoresSelected = activeStores.length > 0 && activeStores.every((s) => form.storeIds.includes(s.id));
  const toggleSelectAllStores = () => {
    setForm((f) => ({
      ...f,
      storeIds: allActiveStoresSelected ? [] : activeStores.map((s) => s.id),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, productType: activeType };
      if (editing) {
        await api.put(`/products/${editing.id}`, payload);
        toast.success('Product updated');
      } else {
        await api.post('/products', payload);
        toast.success('Product created');
      }
      setDialogOpen(false);
      fetchProducts();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/products/${deleteTarget.id}`);
      toast.success('Product permanently deleted');
      setDeleteTarget(null);
      fetchProducts();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    try {
      await api.post('/products/bulk-delete', { ids: Array.from(selectedIds) });
      toast.success('Products permanently deleted');
      setBulkDeleteOpen(false);
      setSelectedIds(new Set());
      fetchProducts();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description={canManageProducts ? 'Manage your product catalog' : 'View products and stock for your store'}
        actions={
          canManageProducts && (
            <>
              {isAdmin && (
                <Button variant="destructive" onClick={() => setBulkDeleteOpen(true)} disabled={selectedIds.size === 0}>
                  <Trash2 className="h-4 w-4" /> Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                </Button>
              )}
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" /> Add Product
              </Button>
            </>
          )
        }
      />

      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, SKU, or barcode..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="p-4">
        {loading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : products.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No products found"
            description={
              canManageProducts ? 'Try adjusting your filters, or add your first product.' : 'No products have been assigned to your store yet.'
            }
            action={canManageProducts && <Button onClick={openCreate}><Plus className="h-4 w-4" /> Add Product</Button>}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  {isAdmin && (
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border"
                        checked={allOnPageSelected}
                        onChange={toggleSelectAll}
                        aria-label="Select all products on this page"
                      />
                    </TableHead>
                  )}
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Status</TableHead>
                  {canManageProducts && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    isAdmin={isAdmin}
                    canManageProducts={canManageProducts}
                    selected={selectedIds.has(p.id)}
                    onToggleSelect={toggleSelect}
                    onEdit={openEdit}
                    onDeleteRequest={handleDeleteRequest}
                  />
                ))}
              </TableBody>
            </Table>
            <Pagination page={page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} />
          </>
        )}
      </Card>

      {canManageProducts && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent
            className="max-w-2xl"
            onInteractOutside={(e) => {
              // The tile-option dropdown panels (Size/Grade/SQR Meter/etc.) are
              // portaled straight to <body> so they aren't clipped by this
              // dialog's own overflow — but that also puts them outside
              // Radix's DialogContent DOM subtree, so a click on one of their
              // options otherwise registers as an "outside click" and closes
              // the whole dialog before the selection is ever seen.
              const target = e.detail?.originalEvent?.target ?? e.target;
              if (target?.closest?.('[data-tile-option-panel]')) e.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit Product' : 'Add Product'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Category</Label>
                  <Select value={form.categoryId || 'none'} onValueChange={(v) => setForm({ ...form, categoryId: v === 'none' ? '' : v })}>
                    <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Uncategorized</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name} ({c.type})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {isTilesForm ? 'Showing the Tiles product form.' : 'Showing the standard (Article/Company) product form.'}
                  </p>
                </div>

                {isTilesForm ? (
                  <>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Product Name</Label>
                      <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </div>
                    {TILE_OPTION_FIELDS.map((f) => (
                      <TileOptionField
                        key={f.key}
                        label={f.label}
                        type={f.type}
                        placeholder={f.placeholder}
                        value={form[f.formKey]}
                        onChange={(v) => setForm((prev) => ({ ...prev, [f.formKey]: v }))}
                        options={tileOptions[f.key]}
                        onAdd={(v) => addTileOption(f.key, v)}
                        onDelete={(id) => deleteTileOption(f.key, id)}
                      />
                    ))}
                    <div className="space-y-1.5">
                      <Label>Quantity (unit) {editing && <span className="text-xs text-muted-foreground">(updates stock for your current store)</span>}</Label>
                      <Input type="number" min="0" required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label>Article</Label>
                      <Input placeholder="Article number / code" value={form.article} onChange={(e) => setForm({ ...form, article: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Company</Label>
                      <Input placeholder="Brand / manufacturer" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Product Name</Label>
                      <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Unit</Label>
                      <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {UNIT_OPTIONS.map((u) => (
                            <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Quantity {editing && <span className="text-xs text-muted-foreground">(updates stock for your current store)</span>}</Label>
                      <Input type="number" min="0" required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
                    </div>
                  </>
                )}

                {!editing && (
                  <p className="text-xs text-muted-foreground sm:col-span-2 -mt-2">
                    {currentStore?.is_main
                      ? 'Creating from the Main Store: this product becomes available in every store, with the initial stock above added to the Main Store (every other store starts at zero).'
                      : `Creating from ${currentStore?.name || 'your store'}: this product will only be available here, at the initial stock above.`}
                  </p>
                )}

                <div className="space-y-1.5">
                  <Label>Purchase Price</Label>
                  <Input type="number" step="0.01" min="0" required value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Low Quantity Alert</Label>
                  <Input type="number" min="0" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Description</Label>
                  <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
                {isAdmin && activeStores.length > 0 && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>
                      {editing ? (
                        <>Also assign to additional stores <span className="text-xs font-normal text-muted-foreground">(optional — adds this product at zero stock; does not remove it from any store)</span></>
                      ) : (
                        <>Assign to Stores <span className="text-xs font-normal text-muted-foreground">(all active stores are selected by default — uncheck a store to exclude this product from it)</span></>
                      )}
                    </Label>
                    <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-border p-3">
                      <label className="flex items-center gap-2 text-sm font-semibold">
                        <input
                          type="checkbox"
                          checked={allActiveStoresSelected}
                          onChange={toggleSelectAllStores}
                          className="h-4 w-4 rounded border-border"
                        />
                        Select All
                      </label>
                      {activeStores.map((s) => (
                        <label key={s.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={form.storeIds.includes(s.id)}
                            onChange={() => toggleStoreId(s.id)}
                            className="h-4 w-4 rounded border-border"
                          />
                          {s.name || 'Unnamed store'}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" variant="success" loading={saving}>{editing ? 'Save Changes' : 'Create Product'}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Permanently delete product?"
        description={`"${deleteTarget?.name}" and its history will be permanently removed from the database. This cannot be undone.`}
        loading={deleting}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Permanently delete selected products?"
        description={`${selectedIds.size} product(s) and their history will be permanently removed from the database. This cannot be undone.`}
        loading={bulkDeleting}
        onConfirm={handleBulkDelete}
      />
    </div>
  );
}
