import { useEffect, useState, useCallback } from 'react';
import { FileDown, FileSpreadsheet, BarChart3 } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import { useSettings } from '@/context/SettingsContext';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/Select';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDate } from '@/lib/utils';
import { exportReportToPdf, exportReportToExcel } from '@/lib/exportReport';

const REPORT_TABS = [
  { id: 'sales', label: 'Sales Report' },
  { id: 'top-products', label: 'Top Selling Products' },
  { id: 'stock', label: 'Stock Report' },
  { id: 'profit', label: 'Profit Report' },
];

export default function Reports() {
  const { settings } = useSettings();
  const { isAdmin } = useAuth();
  const currency = settings?.currency || 'PKR';

  const tabs = isAdmin ? [...REPORT_TABS, { id: 'all-stores', label: 'All Stores' }] : REPORT_TABS;

  const [tab, setTab] = useState('sales');
  const [period, setPeriod] = useState('daily');
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      let data;
      if (tab === 'sales') {
        ({ data } = await api.get('/reports/sales', { params: { period } }));
      } else if (tab === 'top-products') {
        ({ data } = await api.get('/reports/top-products', { params: { limit: 20 } }));
      } else if (tab === 'stock') {
        ({ data } = await api.get('/reports/stock'));
      } else if (tab === 'all-stores') {
        ({ data } = await api.get('/reports/all-stores'));
      } else {
        ({ data } = await api.get('/reports/profit'));
      }
      setRows(data.data);
      setMeta(data.meta || null);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [tab, period]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const getExportData = () => {
    if (tab === 'sales') {
      return {
        title: `Sales Report (${period})`,
        columns: ['Period', 'Orders', 'Subtotal', 'Discount', 'Tax', 'Total'],
        rows: rows.map((r) => [formatDate(r.period), r.orders, r.subtotal, r.discount, r.tax, r.total]),
      };
    }
    if (tab === 'top-products') {
      return {
        title: 'Top Selling Products',
        columns: ['Product', 'SKU', 'Units Sold', 'Revenue'],
        rows: rows.map((r) => [r.product_name, r.sku || '—', r.units_sold, r.revenue]),
      };
    }
    if (tab === 'stock') {
      return {
        title: 'Stock Report',
        columns: ['Product', 'SKU', 'Category', 'Quantity', 'Unit', 'Purchase Price', 'Selling Price', 'Stock Value'],
        rows: rows.map((r) => [r.name, r.sku || '—', r.category_name || '—', r.quantity, r.unit, r.purchase_price, r.selling_price, r.stock_value]),
      };
    }
    if (tab === 'all-stores') {
      return {
        title: 'All Stores Report',
        columns: ['Store', 'Type', 'Orders', 'Total Sales', 'Total Expenses', 'Net Profit'],
        rows: rows.map((r) => [r.store_name, r.is_main ? 'Main' : 'Sub', r.total_orders, r.total_sales, r.total_expenses, r.net_profit]),
      };
    }
    return {
      title: 'Profit Report',
      columns: ['Date', 'Revenue', 'Cost', 'Profit'],
      rows: rows.map((r) => [formatDate(r.date), r.revenue, r.cost, r.profit]),
    };
  };

  const handleExportPdf = () => {
    const { title, columns, rows: exportRows } = getExportData();
    exportReportToPdf(title, columns, exportRows, tab);
  };

  const handleExportExcel = () => {
    const { title, columns, rows: exportRows } = getExportData();
    exportReportToExcel(title, columns, exportRows, tab);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Analyze sales, stock, and profitability"
        actions={
          <>
            <Button variant="outline" onClick={handleExportPdf} disabled={rows.length === 0}>
              <FileDown className="h-4 w-4" /> Export PDF
            </Button>
            <Button variant="outline" onClick={handleExportExcel} disabled={rows.length === 0}>
              <FileSpreadsheet className="h-4 w-4" /> Export Excel
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-border bg-secondary/50 p-1 w-fit">
          {tabs.map((t) => (
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

        {tab === 'sales' && (
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {meta && tab === 'profit' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="p-4"><p className="text-sm text-muted-foreground">Total Revenue</p><p className="text-xl font-bold">{formatCurrency(meta.revenue, currency)}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">Total Cost</p><p className="text-xl font-bold">{formatCurrency(meta.cost, currency)}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">Net Profit</p><p className="text-xl font-bold text-success">{formatCurrency(meta.profit, currency)}</p></Card>
        </div>
      )}

      {meta && tab === 'stock' && (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Total Stock Value</p>
          <p className="text-xl font-bold">{formatCurrency(meta.totalStockValue, currency)}</p>
        </Card>
      )}

      {meta && tab === 'all-stores' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4"><p className="text-sm text-muted-foreground">Total Sales</p><p className="text-xl font-bold">{formatCurrency(meta.totalSales, currency)}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">Total Orders</p><p className="text-xl font-bold">{meta.totalOrders}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">Total Expenses</p><p className="text-xl font-bold">{formatCurrency(meta.totalExpenses, currency)}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">Net Profit</p><p className="text-xl font-bold text-success">{formatCurrency(meta.netProfit, currency)}</p></Card>
        </div>
      )}

      <Card className="p-4">
        {loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : rows.length === 0 ? (
          <EmptyState icon={BarChart3} title="No data available" description="Try a different period or check back after making some sales." />
        ) : tab === 'sales' ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead><TableHead>Orders</TableHead><TableHead>Subtotal</TableHead>
                <TableHead>Discount</TableHead><TableHead>Tax</TableHead><TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{formatDate(r.period)}</TableCell>
                  <TableCell><Badge variant="secondary">{r.orders}</Badge></TableCell>
                  <TableCell>{formatCurrency(r.subtotal, currency)}</TableCell>
                  <TableCell>{formatCurrency(r.discount, currency)}</TableCell>
                  <TableCell>{formatCurrency(r.tax, currency)}</TableCell>
                  <TableCell className="font-semibold">{formatCurrency(r.total, currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : tab === 'top-products' ? (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead>Units Sold</TableHead><TableHead>Revenue</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.product_name}</TableCell>
                  <TableCell className="text-muted-foreground">{r.sku || '—'}</TableCell>
                  <TableCell><Badge variant="secondary">{r.units_sold}</Badge></TableCell>
                  <TableCell className="font-semibold">{formatCurrency(r.revenue, currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : tab === 'stock' ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead><TableHead>Category</TableHead><TableHead>Quantity</TableHead>
                <TableHead>Purchase Price</TableHead><TableHead>Selling Price</TableHead><TableHead>Stock Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-muted-foreground">{r.category_name || '—'}</TableCell>
                  <TableCell>
                    <span className={r.is_low_stock ? 'font-semibold text-destructive' : ''}>{r.quantity} {r.unit}</span>
                  </TableCell>
                  <TableCell>{formatCurrency(r.purchase_price, currency)}</TableCell>
                  <TableCell>{formatCurrency(r.selling_price, currency)}</TableCell>
                  <TableCell className="font-semibold">{formatCurrency(r.stock_value, currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : tab === 'all-stores' ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead><TableHead>Type</TableHead><TableHead>Orders</TableHead>
                <TableHead>Total Sales</TableHead><TableHead>Total Expenses</TableHead><TableHead>Net Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.store_id}>
                  <TableCell className="font-medium">{r.store_name}</TableCell>
                  <TableCell><Badge variant={r.is_main ? 'default' : 'secondary'}>{r.is_main ? 'Main' : 'Sub'}</Badge></TableCell>
                  <TableCell>{r.total_orders}</TableCell>
                  <TableCell>{formatCurrency(r.total_sales, currency)}</TableCell>
                  <TableCell>{formatCurrency(r.total_expenses, currency)}</TableCell>
                  <TableCell className="font-semibold text-success">{formatCurrency(r.net_profit, currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Date</TableHead><TableHead>Revenue</TableHead><TableHead>Cost</TableHead><TableHead>Profit</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{formatDate(r.date)}</TableCell>
                  <TableCell>{formatCurrency(r.revenue, currency)}</TableCell>
                  <TableCell>{formatCurrency(r.cost, currency)}</TableCell>
                  <TableCell className="font-semibold text-success">{formatCurrency(r.profit, currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
