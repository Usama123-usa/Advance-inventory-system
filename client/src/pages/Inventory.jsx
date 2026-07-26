import { useEffect, useState, useCallback } from 'react';
import { Search, ArrowUpCircle, ArrowDownCircle, AlertTriangle, History, Boxes } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/Textarea';
import { Card } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { Badge } from '@/components/ui/Badge';
import { formatDateTime } from '@/lib/utils';

export default function Inventory() {
  const [tab, setTab] = useState('current');
  const [stock, setStock] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });

  const [adjustDialog, setAdjustDialog] = useState(null); // { type: 'in'|'out', product }
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchCurrent = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/inventory/current', { params: { search: debouncedSearch, page, limit: 10 } });
      setStock(data.data);
      setPagination(data.pagination);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page]);

  const fetchLowStock = useCallback(async () => {
    const { data } = await api.get('/inventory/low-stock');
    setLowStock(data.data);
  }, []);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/inventory/history', { params: { page, limit: 15 } });
      setHistory(data.data);
      setPagination(data.pagination);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchLowStock();
  }, [fetchLowStock]);

  useEffect(() => {
    setPage(1);
  }, [tab, debouncedSearch]);

  useEffect(() => {
    if (tab === 'current') fetchCurrent();
    if (tab === 'history') fetchHistory();
  }, [tab, fetchCurrent, fetchHistory]);

  const openAdjust = (type, product) => {
    setAdjustDialog({ type, product });
    setQuantity('');
    setReason('');
  };

  const handleAdjust = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const endpoint = adjustDialog.type === 'in' ? '/inventory/stock-in' : '/inventory/stock-out';
      await api.post(endpoint, { productId: adjustDialog.product.id, quantity: Number(quantity), reason });
      toast.success(`Stock ${adjustDialog.type === 'in' ? 'added' : 'removed'} successfully`);
      setAdjustDialog(null);
      fetchCurrent();
      fetchLowStock();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const TABS = [
    { id: 'current', label: 'Current Stock' },
    { id: 'low-stock', label: `Low Stock (${lowStock.length})` },
    { id: 'history', label: 'History' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Inventory" description="Track stock levels and movements" />

      <div className="flex gap-1 rounded-lg border border-border bg-secondary/50 p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab !== 'low-stock' && (
        <Card className="p-4">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search products..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </Card>
      )}

      {tab === 'current' && (
        <Card className="p-4">
          {loading ? (
            <TableSkeleton rows={6} cols={5} />
          ) : stock.length === 0 ? (
            <EmptyState icon={Boxes} title="No products found" />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Current Stock</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stock.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-muted-foreground">{p.category_name || '—'}</TableCell>
                      <TableCell>{p.quantity} {p.unit}</TableCell>
                      <TableCell>
                        {p.is_low_stock ? (
                          <Badge variant="destructive">Low Stock</Badge>
                        ) : (
                          <Badge variant="success">In Stock</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => openAdjust('in', p)}>
                            <ArrowUpCircle className="h-4 w-4 text-success" /> Stock In
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => openAdjust('out', p)}>
                            <ArrowDownCircle className="h-4 w-4 text-destructive" /> Stock Out
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} />
            </>
          )}
        </Card>
      )}

      {tab === 'low-stock' && (
        <Card className="p-4">
          {lowStock.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="Nothing low on stock" description="All products are above their threshold." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Threshold</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lowStock.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-muted-foreground">{p.category_name || '—'}</TableCell>
                    <TableCell className="font-semibold text-destructive">{p.quantity} {p.unit}</TableCell>
                    <TableCell>{p.low_stock_threshold}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => openAdjust('in', p)}>
                        <ArrowUpCircle className="h-4 w-4 text-success" /> Restock
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'history' && (
        <Card className="p-4">
          {loading ? (
            <TableSkeleton rows={6} cols={5} />
          ) : history.length === 0 ? (
            <EmptyState icon={History} title="No inventory activity yet" />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Change</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-medium">{log.product_name}</TableCell>
                      <TableCell>
                        <Badge
                          variant={log.change_type === 'in' ? 'success' : log.change_type === 'out' ? 'destructive' : 'secondary'}
                          className="capitalize"
                        >
                          {log.change_type}
                        </Badge>
                      </TableCell>
                      <TableCell>{log.previous_quantity} → {log.new_quantity}</TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">{log.reason || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{log.created_by_name || 'System'}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDateTime(log.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} />
            </>
          )}
        </Card>
      )}

      <Dialog open={!!adjustDialog} onOpenChange={(open) => !open && setAdjustDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {adjustDialog?.type === 'in' ? 'Stock In' : 'Stock Out'} — {adjustDialog?.product?.name}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdjust} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Quantity</Label>
              <Input type="number" min="1" required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Reason (optional)</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. New shipment received" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAdjustDialog(null)}>Cancel</Button>
              <Button type="submit" loading={saving} variant={adjustDialog?.type === 'in' ? 'success' : 'destructive'}>
                Confirm
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
