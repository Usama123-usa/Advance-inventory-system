import { useEffect, useState, useCallback } from 'react';
import { Search, Wallet2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useSettings } from '@/context/SettingsContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatCard } from '@/components/ui/StatCard';
import { formatCurrency, formatDateTime } from '@/lib/utils';

export default function PendingPayments() {
  const { settings } = useSettings();
  const currency = settings?.currency || 'PKR';

  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const fetchBalances = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/sales/pending-payments');
      setBalances(data.data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBalances(); }, [fetchBalances]);

  const filtered = balances.filter((b) => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      b.customer_name?.toLowerCase().includes(q) ||
      b.customer_phone?.toLowerCase().includes(q) ||
      b.customer_cnic?.toLowerCase().includes(q)
    );
  });

  const totalOwed = balances.reduce((sum, b) => sum + Number(b.total_remaining_balance), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Pending Payments" description="Customers with an outstanding balance from partial payments" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Customers Owing" value={balances.length} icon={Wallet2} />
        <StatCard label="Total Outstanding" value={formatCurrency(totalOwed, currency)} icon={Wallet2} iconClassName="bg-destructive/10 text-destructive" />
      </div>

      <Card className="p-4">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by name, phone, or CNIC..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </Card>

      <Card className="p-4">
        {loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Wallet2} title="No pending payments" description="Every customer is paid in full." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>CNIC</TableHead>
                <TableHead>Remaining Balance</TableHead>
                <TableHead>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.customer_name}</TableCell>
                  <TableCell className="text-muted-foreground">{b.customer_phone || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{b.customer_cnic || '—'}</TableCell>
                  <TableCell className="font-semibold text-destructive">{formatCurrency(b.total_remaining_balance, currency)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(b.updated_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
