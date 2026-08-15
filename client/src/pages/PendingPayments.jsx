import { useEffect, useState, useCallback } from 'react';
import { Search, Wallet2, Pencil, HandCoins, Plus, History as HistoryIcon, Printer, Download, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useSettings } from '@/context/SettingsContext';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Card } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import { generatePaymentHistoryPdf } from '@/lib/generatePaymentHistoryPdf';

const today = () => new Date().toISOString().slice(0, 10);

const emptyAddForm = { customerName: '', customerPhone: '', customerAddress: '', amount: '', paymentDate: today() };
const emptyEditForm = { customerName: '', customerPhone: '', customerAddress: '', totalRemainingBalance: '' };

export default function PendingPayments() {
  const { settings } = useSettings();
  const { isAdmin } = useAuth();
  const currency = settings?.currency || 'PKR';

  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(emptyAddForm);
  const [adding, setAdding] = useState(false);

  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [saving, setSaving] = useState(false);

  const [payTarget, setPayTarget] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(today());
  const [paying, setPaying] = useState(false);

  const [historyTarget, setHistoryTarget] = useState(null);
  const [historyData, setHistoryData] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

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
      b.customer_address?.toLowerCase().includes(q)
    );
  });

  const totalOwed = balances.reduce((sum, b) => sum + Number(b.total_remaining_balance), 0);

  const openAdd = () => {
    setAddForm(emptyAddForm);
    setAddOpen(true);
  };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setAdding(true);
    try {
      await api.post('/sales/pending-payments', addForm);
      toast.success('Customer added to Pending Payments');
      setAddOpen(false);
      fetchBalances();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  const openEdit = (balance) => {
    setEditTarget(balance);
    setEditForm({
      customerName: balance.customer_name || '',
      customerPhone: balance.customer_phone || '',
      customerAddress: balance.customer_address || '',
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
    setPayAmount(Number(balance.total_remaining_balance).toFixed(2));
    setPayDate(today());
  };

  const handlePaySubmit = async (e) => {
    e.preventDefault();
    setPaying(true);
    try {
      await api.post(`/sales/pending-payments/${payTarget.id}/payment`, { amount: Number(payAmount), paymentDate: payDate });
      toast.success('Payment recorded');
      setPayTarget(null);
      fetchBalances();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setPaying(false);
    }
  };

  const openHistory = async (balance) => {
    setHistoryTarget(balance);
    setHistoryData(null);
    setHistoryLoading(true);
    try {
      const { data } = await api.get(`/sales/pending-payments/${balance.id}/history`);
      setHistoryData(data.data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleDownloadHistory = () => {
    if (!historyData) return;
    generatePaymentHistoryPdf(historyData.customer, historyData.history, settings);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/sales/pending-payments/${deleteTarget.id}`);
      toast.success('Pending payment record deleted');
      setDeleteTarget(null);
      fetchBalances();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pending Payments"
        description="Customers with an outstanding balance"
        actions={<Button onClick={openAdd}><Plus className="h-4 w-4" /> Add New Customer</Button>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Customers Owing" value={balances.length} icon={Wallet2} iconClassName="bg-orange/10 text-orange" />
        <StatCard label="Total Outstanding" value={formatCurrency(totalOwed, currency)} icon={Wallet2} iconClassName="bg-rose/10 text-rose" />
      </div>

      <Card className="p-4">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by name, phone, or address..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
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
                <TableHead>Address</TableHead>
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
                  <TableCell className="text-muted-foreground">{b.customer_address || '—'}</TableCell>
                  <TableCell className="font-semibold text-rose">{formatCurrency(b.total_remaining_balance, currency)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(b.updated_at)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openHistory(b)} title="Payment history">
                        <HistoryIcon className="h-4 w-4 text-primary" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(b)} title="Edit">
                        <Pencil className="h-4 w-4 text-primary" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openPay(b)} title="Receive Payment">
                        <HandCoins className="h-4 w-4 text-success" />
                      </Button>
                      {isAdmin && (
                        <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(b)} title="Delete">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Add New Customer */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add New Customer</DialogTitle></DialogHeader>
          <form onSubmit={handleAddSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Customer Name</Label>
              <Input required value={addForm.customerName} onChange={(e) => setAddForm({ ...addForm, customerName: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input required value={addForm.customerPhone} onChange={(e) => setAddForm({ ...addForm, customerPhone: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Address</Label>
                <Input value={addForm.customerAddress} onChange={(e) => setAddForm({ ...addForm, customerAddress: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={addForm.amount}
                  onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Payment Date</Label>
                <Input
                  type="date"
                  required
                  value={addForm.paymentDate}
                  onChange={(e) => setAddForm({ ...addForm, paymentDate: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" variant="success" loading={adding}>Add Customer</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit */}
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
                <Label>Address</Label>
                <Input
                  value={editForm.customerAddress}
                  onChange={(e) => setEditForm({ ...editForm, customerAddress: e.target.value })}
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
              <Button type="submit" variant="success" loading={saving}>Save Changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Receive Payment */}
      <Dialog open={!!payTarget} onOpenChange={(open) => !open && setPayTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Receive Payment</DialogTitle></DialogHeader>
          <form onSubmit={handlePaySubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {payTarget?.customer_name} owes{' '}
              <span className="font-semibold text-rose">
                {formatCurrency(payTarget?.total_remaining_balance || 0, currency)}
              </span>
            </p>
            <div className="grid grid-cols-2 gap-4">
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
              <div className="space-y-1.5">
                <Label>Payment Date</Label>
                <Input type="date" required value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPayTarget(null)}>Cancel</Button>
              <Button type="submit" variant="success" loading={paying}>Record Payment</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Payment History */}
      <Dialog open={!!historyTarget} onOpenChange={(open) => !open && setHistoryTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Payment History — {historyTarget?.customer_name}</DialogTitle>
          </DialogHeader>
          {historyLoading ? (
            <TableSkeleton rows={4} cols={3} />
          ) : historyData?.history?.length ? (
            <>
              <div id="payment-history-print" className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyData.history.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{formatDate(row.payment_date)}</TableCell>
                        <TableCell>
                          <Badge variant={row.entry_type === 'charge' ? 'orange' : 'success'}>
                            {row.entry_type === 'charge' ? 'Charge' : 'Payment'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(row.amount, currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
                <span className="text-muted-foreground">Remaining Balance</span>
                <span className="font-semibold text-rose">
                  {formatCurrency(historyData.customer.total_remaining_balance, currency)}
                </span>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" className="border-primary/30 text-primary hover:bg-primary/5" onClick={() => window.print()}>
                  <Printer className="h-4 w-4" /> Print
                </Button>
                <Button type="button" onClick={handleDownloadHistory}>
                  <Download className="h-4 w-4" /> Download PDF
                </Button>
              </DialogFooter>
            </>
          ) : (
            <EmptyState icon={HistoryIcon} title="No history yet" description="No charges or payments recorded for this customer." />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this pending payment record?"
        description={
          deleteTarget
            ? `"${deleteTarget.customer_name}" (${formatCurrency(deleteTarget.total_remaining_balance, currency)} owing) and their full payment history will be permanently removed from Pending Payments. This does not affect stock or the original sale record. This cannot be undone.`
            : ''
        }
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
