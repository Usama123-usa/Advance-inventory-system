import { useEffect, useState, useCallback } from 'react';
import { Search, Wallet2, Pencil, HandCoins } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useSettings } from '@/context/SettingsContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Card } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog';
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

  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ customerName: '', customerPhone: '', customerCnic: '', totalRemainingBalance: '' });
  const [saving, setSaving] = useState(false);

  const [payTarget, setPayTarget] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [paying, setPaying] = useState(false);

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

  const openEdit = (balance) => {
    setEditTarget(balance);
    setEditForm({
      customerName: balance.customer_name || '',
      customerPhone: balance.customer_phone || '',
      customerCnic: balance.customer_cnic || '',
      totalRemainingBalance: String(balance.total_remaining_balance),
    });
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/sales/pending-payments/${editTarget.id}`, editForm);
      toast.success('Pending payment updated');
      setEditTarget(null);
      fetchBalances();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const openPay = (balance) => {
    setPayTarget(balance);
    setPayAmount(String(balance.total_remaining_balance));
  };

  const handlePaySubmit = async (e) => {
    e.preventDefault();
    setPaying(true);
    try {
      await api.post(`/sales/pending-payments/${payTarget.id}/payment`, { amount: Number(payAmount) });
      toast.success('Payment recorded');
      setPayTarget(null);
      fetchBalances();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setPaying(false);
    }
  };

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
          <TableSkeleton rows={6} cols={6} />
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
                <TableHead className="text-right">Actions</TableHead>
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
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(b)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openPay(b)} title="Receive Payment">
                        <HandCoins className="h-4 w-4 text-primary" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Pending Payment</DialogTitle></DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Customer Name</Label>
              <Input
                value={editForm.customerName}
                onChange={(e) => setEditForm({ ...editForm, customerName: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input
                  value={editForm.customerPhone}
                  onChange={(e) => setEditForm({ ...editForm, customerPhone: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>CNIC</Label>
                <Input
                  value={editForm.customerCnic}
                  onChange={(e) => setEditForm({ ...editForm, customerCnic: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Remaining Balance</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                required
                value={editForm.totalRemainingBalance}
                onChange={(e) => setEditForm({ ...editForm, totalRemainingBalance: e.target.value })}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
              <Button type="submit" loading={saving}>Save Changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!payTarget} onOpenChange={(open) => !open && setPayTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Receive Payment</DialogTitle></DialogHeader>
          <form onSubmit={handlePaySubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {payTarget?.customer_name} owes{' '}
              <span className="font-semibold text-destructive">
                {formatCurrency(payTarget?.total_remaining_balance || 0, currency)}
              </span>
            </p>
            <div className="space-y-1.5">
              <Label>Amount Received</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max={payTarget?.total_remaining_balance}
                required
                autoFocus
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPayTarget(null)}>Cancel</Button>
              <Button type="submit" loading={paying}>Record Payment</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
