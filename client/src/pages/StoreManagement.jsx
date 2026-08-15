import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Archive, Building2, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import { useStore } from '@/context/StoreContext';
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
import { Badge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/utils';

const emptyCreateForm = { name: '', managerEmail: '', managerPassword: '', importProducts: false };

export default function StoreManagement() {
  const { refreshStores } = useStore();
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [creating, setCreating] = useState(false);

  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiving, setArchiving] = useState(false);

  const fetchStores = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/stores');
      setStores(data.data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStores(); }, [fetchStores]);

  const openCreate = () => {
    setCreateForm(emptyCreateForm);
    setCreateOpen(true);
  };

  const openEdit = (store) => {
    setEditing(store);
    setEditName(store.name);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post('/stores', createForm);
      toast.success('Store created');
      setCreateOpen(false);
      fetchStores();
      refreshStores(true);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/stores/${editing.id}`, { name: editName });
      toast.success('Store updated');
      setEditing(null);
      fetchStores();
      refreshStores(true);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (store) => {
    try {
      await api.put(`/stores/${store.id}`, { isActive: !store.is_active });
      toast.success(store.is_active ? 'Store archived' : 'Store reactivated');
      fetchStores();
      refreshStores(true);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleArchive = async () => {
    setArchiving(true);
    try {
      await api.delete(`/stores/${archiveTarget.id}`);
      toast.success('Store archived');
      setArchiveTarget(null);
      fetchStores();
      refreshStores(true);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Store Management"
        description="Create and manage your Main Store and Sub Stores"
        actions={<Button onClick={openCreate}><Plus className="h-4 w-4" /> Add Sub Store</Button>}
      />

      <Card className="p-4">
        {loading ? (
          <TableSkeleton rows={4} cols={4} />
        ) : stores.length === 0 ? (
          <EmptyState icon={Building2} title="No stores found" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stores.map((store) => (
                <TableRow key={store.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {store.is_main && <ShieldCheck className="h-4 w-4 text-primary" />}
                      {store.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={store.is_main ? 'default' : 'secondary'}>{store.is_main ? 'Main Store' : 'Sub Store'}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={store.is_active ? 'success' : 'secondary'}>{store.is_active ? 'Active' : 'Archived'}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(store.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(store)}>
                        <Pencil className="h-4 w-4 text-primary" />
                      </Button>
                      {!store.is_main && (
                        <Button variant="ghost" size="icon" onClick={() => (store.is_active ? setArchiveTarget(store) : toggleActive(store))}>
                          <Archive className={store.is_active ? 'h-4 w-4 text-destructive' : 'h-4 w-4 text-success'} />
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Sub Store</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Store Name</Label>
              <Input required value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Manager Email</Label>
              <Input type="email" required value={createForm.managerEmail} onChange={(e) => setCreateForm({ ...createForm, managerEmail: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Manager Password</Label>
              <Input type="password" required minLength={6} value={createForm.managerPassword} onChange={(e) => setCreateForm({ ...createForm, managerPassword: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border"
                checked={createForm.importProducts}
                onChange={(e) => setCreateForm({ ...createForm, importProducts: e.target.checked })}
              />
              Import existing products from Main Store (starts at zero stock)
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" variant="success" loading={creating}>Create Store</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename Store</DialogTitle></DialogHeader>
          <form onSubmit={handleRename} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Store Name</Label>
              <Input required value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" variant="success" loading={saving}>Save Changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title="Archive this store?"
        description={`"${archiveTarget?.name}" will be hidden from the store switcher. Its sales and expense history is kept.`}
        confirmLabel="Archive"
        loading={archiving}
        onConfirm={handleArchive}
      />
    </div>
  );
}
