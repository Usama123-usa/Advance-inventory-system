import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Receipt, Eye, Trash2 } from 'lucide-react';
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
import { formatCurrency, formatDateTime } from '@/lib/utils';

const STATUS_VARIANT = {
  paid: 'success',
  partial: 'warning',
  unpaid: 'destructive',
  pending: 'warning',
  refunded: 'secondary',
};

export default function Sales() {
  const { settings } = useSettings();
  const { isAdmin } = useAuth();
  const currency = settings?.currency || 'PKR';
  const navigate = useNavigate();

  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const fetchSales = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/sales', {
        params: { search: debouncedSearch, page, limit: 20 },
      });
      setSales(data.data);
      setPagination(data.pagination);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page]);

  useEffect(() => { fetchSales(); }, [fetchSales]);
  useEffect(() => setPage(1), [debouncedSearch]);

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

  return (
    <div className="space-y-6">
      <PageHeader title="Sales" description="History of every invoice generated at the till" />

      <Card className="p-4">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by invoice number..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </Card>

      <Card className="p-4">
        {loading ? (
          <TableSkeleton rows={8} cols={7} />
        ) : sales.length === 0 ? (
          <EmptyState icon={Receipt} title="No sales yet" description="Invoices generated from the POS will show up here." />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
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
                    <TableCell className="text-muted-foreground">{formatDateTime(sale.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => navigate(`/invoice/${sale.id}`)} title="View invoice">
                          <Eye className="h-4 w-4" />
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
    </div>
  );
}
