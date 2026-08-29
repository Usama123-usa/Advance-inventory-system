import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Receipt, Eye, Trash2, X, Undo2, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useSettings } from '@/context/SettingsContext';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SalesReturnDialog } from '@/components/sales/SalesReturnDialog';
import { generateInvoicesPdf } from '@/lib/generateInvoicePdf';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';

const STATUS_VARIANT = {
  paid: 'success',
  partial: 'orange',
  unpaid: 'destructive',
  pending: 'orange',
  refunded: 'secondary',
};

export default function Sales() {
  const { settings } = useSettings();
  const { isAdmin } = useAuth();
  const currency = settings?.currency || 'PKR';
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });

  // Prefilled from the URL when arriving via a link like Dashboard's
  // "Today's Sales" card (?from=<ISO>), so the filter is visible and
  // adjustable rather than a hidden one-shot query.
  const [startDate, setStartDate] = useState(() => searchParams.get('from')?.slice(0, 10) || '');
  const [endDate, setEndDate] = useState(() => searchParams.get('to')?.slice(0, 10) || '');
  const hasDateFilter = Boolean(startDate || endDate);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [downloading, setDownloading] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnSaleId, setReturnSaleId] = useState(null);

  const fetchSales = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/sales', {
        params: {
          search: debouncedSearch,
          // Whole-day bounds in UTC — matches the boundary the dashboard's
          // Today's Sales figure is computed with, so the two never disagree.
          from: startDate ? `${startDate}T00:00:00.000Z` : undefined,
          to: endDate ? `${endDate}T23:59:59.999Z` : undefined,
          page,
          limit: 20,
        },
      });
      setSales(data.data);
      setPagination(data.pagination);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, startDate, endDate, page]);

  useEffect(() => { fetchSales(); }, [fetchSales]);
  useEffect(() => setPage(1), [debouncedSearch, startDate, endDate]);
  // Selection is page/filter-scoped — dropping it whenever the visible rows
  // change avoids "downloading" invoices that are no longer on screen.
  useEffect(() => setSelectedIds(new Set()), [debouncedSearch, startDate, endDate, page]);

  // Once the initial filter (if any) has been applied, drop it from the URL
  // so it doesn't linger stale — the inputs below remain the source of truth.
  useEffect(() => {
    if (searchParams.has('from') || searchParams.has('to')) setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearDateFilter = () => {
    setStartDate('');
    setEndDate('');
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/sales/${deleteTarget.id}`);
      toast.success('Sale deleted — stock has been restored');
      setDeleteTarget(null);
      fetchSales();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      const results = await Promise.allSettled(Array.from(selectedIds).map((id) => api.delete(`/sales/${id}`)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      const succeeded = results.length - failed;
      if (succeeded > 0) toast.success(`${succeeded} sale(s) deleted — stock restored`);
      if (failed > 0) toast.error(`${failed} sale(s) could not be deleted`);
      setBulkDeleteOpen(false);
      setSelectedIds(new Set());
      fetchSales();
    } finally {
      setBulkDeleting(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allOnPageSelected = sales.length > 0 && sales.every((s) => selectedIds.has(s.id));
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (allOnPageSelected) return new Set();
      const next = new Set(prev);
      sales.forEach((s) => next.add(s.id));
      return next;
    });
  };

  const openReturnDialog = (saleId = null) => {
    setReturnSaleId(saleId);
    setReturnDialogOpen(true);
  };

  const handleDownloadSelected = async () => {
    if (selectedIds.size === 0) return;
    setDownloading(true);
    try {
      const results = await Promise.all(Array.from(selectedIds).map((id) => api.get(`/sales/${id}`)));
      generateInvoicesPdf(results.map((r) => r.data.data), settings);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales"
        description={
          hasDateFilter
            ? `Showing invoices ${startDate ? `from ${formatDate(startDate)}` : ''}${startDate && endDate ? ' ' : ''}${endDate ? `through ${formatDate(endDate)}` : ''}`
            : 'History of every invoice generated at the till'
        }
        actions={
          <>
            <Button variant="outline" onClick={() => openReturnDialog()}>
              <Undo2 className="h-4 w-4" /> Stock Return
            </Button>
            <Button onClick={handleDownloadSelected} loading={downloading} disabled={selectedIds.size === 0}>
              <Download className="h-4 w-4" /> Download{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
            </Button>
            {isAdmin && (
              <Button variant="destructive" onClick={() => setBulkDeleteOpen(true)} disabled={selectedIds.size === 0}>
                <Trash2 className="h-4 w-4" /> Delete Selected{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
              </Button>
            )}
          </>
        }
      />

      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by invoice number..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-auto"
            aria-label="Start date"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-auto"
            aria-label="End date"
          />
          {hasDateFilter && (
            <Button variant="ghost" size="sm" onClick={clearDateFilter}>
              <X className="h-3.5 w-3.5" /> Clear dates
            </Button>
          )}
        </div>
      </Card>

      <Card className="p-4">
        {loading ? (
          <TableSkeleton rows={8} cols={9} />
        ) : sales.length === 0 ? (
          <EmptyState icon={Receipt} title="No sales yet" description="Invoices generated from the POS will show up here." />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={allOnPageSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all invoices on this page"
                    />
                  </TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border"
                        checked={selectedIds.has(sale.id)}
                        onChange={() => toggleSelect(sale.id)}
                        aria-label={`Select invoice ${sale.invoice_number}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{sale.invoice_number}</TableCell>
                    <TableCell className="text-muted-foreground">{sale.customer_name || 'Walk-in Customer'}</TableCell>
                    <TableCell className="text-muted-foreground">{sale.cashier_name || '—'}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{sale.payment_method.replace('_', ' ')}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[sale.payment_status] || 'secondary'} className="capitalize">
                        {sale.payment_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-semibold">{formatCurrency(sale.grand_total, currency)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(sale.sale_date) !== '—' ? formatDate(sale.sale_date) : formatDateTime(sale.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openReturnDialog(sale.id)} title="Stock return">
                          <Undo2 className="h-4 w-4 text-orange" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => navigate(`/invoice/${sale.id}`)} title="View invoice">
                          <Eye className="h-4 w-4 text-purple" />
                        </Button>
                        {isAdmin && (
                          <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(sale)} title="Delete sale">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
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

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this sale?"
        description={
          deleteTarget
            ? `Invoice ${deleteTarget.invoice_number} (${formatCurrency(deleteTarget.grand_total, currency)}) will be permanently removed, its stock restored, and any outstanding balance it created reversed. This cannot be undone.`
            : ''
        }
        loading={deleting}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Delete selected sales?"
        description={(() => {
          const selected = sales.filter((s) => selectedIds.has(s.id));
          const preview = selected.slice(0, 5).map((s) => s.invoice_number).join(', ');
          const remaining = selected.length - 5;
          const names = remaining > 0 ? `${preview}, and ${remaining} more` : preview;
          return `Invoice${selected.length === 1 ? '' : 's'} ${names} will be permanently removed, stock restored, and any outstanding balance reversed. This cannot be undone.`;
        })()}
        loading={bulkDeleting}
        onConfirm={handleBulkDelete}
      />

      <SalesReturnDialog
        open={returnDialogOpen}
        onOpenChange={setReturnDialogOpen}
        initialSaleId={returnSaleId}
        onSuccess={fetchSales}
      />
    </div>
  );
}
