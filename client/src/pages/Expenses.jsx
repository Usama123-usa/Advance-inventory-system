import { useEffect, useState, useCallback } from 'react';
import { Plus, Search, Pencil, Trash2, Wallet, Filter } from 'lucide-react';
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
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/Select';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/ui/StatCard';
import { formatCurrency, formatDate } from '@/lib/utils';

const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyForm = { date: todayIso(), categoryIds: [], description: '', amount: '' };

export default function Expenses() {
  const { settings } = useSettings();
  const currency = settings?.currency || 'PKR';

  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const fetchSummary = useCallback(() => {
    api.get('/expenses/summary').then(({ data }) => setSummary(data.data)).catch(() => {});
  }, []);

  const fetchCategories = useCallback(() => {
    api.get('/expenses/categories').then(({ data }) => setCategories(data.data)).catch(() => {});
  }, []);

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/expenses', {
        params: {
          search: debouncedSearch,
          category: categoryFilter === 'all' ? '' : categoryFilter,
          page,
          limit: 20,
        },
      });
      setExpenses(data.data);
      setPagination(data.pagination);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, categoryFilter, page]);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchCategories(); }, [fetchCategories]);
  useEffect(() => setPage(1), [debouncedSearch, categoryFilter]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (expense) => {
    setEditing(expense);
    setForm({
      date: expense.date,
      categoryIds: (expense.categories || []).map((c) => c.id),
      description: expense.description || '',
      amount: String(expense.amount),
    });
    setDialogOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.categoryIds.length === 0) {
      toast.error('Select at least one expense category');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/expenses/${editing.id}`, form);
        toast.success('Expense updated');
      } else {
        await api.post('/expenses', form);
        toast.success('Expense added');
      }
      setDialogOpen(false);
      fetchExpenses();
      fetchSummary();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/expenses/${deleteTarget.id}`);
      toast.success('Expense deleted');
      setDeleteTarget(null);
      fetchExpenses();
      fetchSummary();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Daily Expenses"
        description="Track expenses for your store"
        actions={<Button onClick={openCreate}><Plus className="h-4 w-4" /> Add Expense</Button>}
      />

      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard label="Today's Expenses" value={formatCurrency(summary.todayTotal, currency)} icon={Wallet} iconClassName="bg-rose/10 text-rose" />
          <StatCard label="This Month's Expenses" value={formatCurrency(summary.monthlyTotal, currency)} icon={Wallet} iconClassName="bg-rose/10 text-rose" />
        </div>
      )}

      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search description..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
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
        </div>
      </Card>

      <Card className="p-4">
        {loading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : expenses.length === 0 ? (
          <EmptyState icon={Wallet} title="No expenses found" action={<Button onClick={openCreate}><Plus className="h-4 w-4" /> Add Expense</Button>} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Added By</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((exp) => (
                  <TableRow key={exp.id}>
                    <TableCell className="text-muted-foreground">{formatDate(exp.date)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(exp.categories || []).length === 0 ? (
                          '—'
                        ) : (
                          exp.categories.map((c) => (
                            <Badge key={c.id} variant="secondary">{c.name}</Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{exp.description || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{exp.created_by_name || '—'}</TableCell>
                    <TableCell className="font-medium text-rose">{formatCurrency(exp.amount, currency)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(exp)}>
                          <Pencil className="h-4 w-4 text-primary" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(exp)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit Expense' : 'Add Expense'}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Categories</Label>
                <MultiSelect
                  options={categoryOptions}
                  value={form.categoryIds}
                  onChange={(ids) => setForm({ ...form, categoryIds: ids })}
                  placeholder="Select categories"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input type="number" step="0.01" min="0" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" variant="success" loading={saving}>{editing ? 'Save Changes' : 'Add Expense'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete expense?"
        description="This expense record will be permanently removed."
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
