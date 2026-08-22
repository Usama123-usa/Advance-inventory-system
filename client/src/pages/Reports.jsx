import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileDown, FileSpreadsheet, BarChart3, Eye } from 'lucide-react';
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
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import { exportReportToPdf, exportReportToExcel, exportMultiSectionPdf, exportMultiSectionExcel } from '@/lib/exportReport';

const REPORT_TABS = [
  { id: 'sales', label: 'Sales Report' },
  { id: 'top-products', label: 'Top Selling Products' },
  { id: 'stock', label: 'Stock Report' },
  { id: 'profit', label: 'Profit Report' },
];

const dateInputClass =
  'h-10 rounded-lg border border-input bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

const todayStr = () => new Date().toISOString().slice(0, 10);
const currentMonthStr = () => new Date().toISOString().slice(0, 7);

const toDateStr = (date) => date.toISOString().slice(0, 10);

// Monday of the week containing dateStr (ISO week, Mon–Sun).
const startOfWeek = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

const firstDayOfMonth = (monthStr) => new Date(`${monthStr}-01T00:00:00.000Z`);
const lastDayOfMonth = (monthStr) => {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0));
};

const monthLabel = (monthStr) => {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

const PERIOD_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', custom: 'Custom Range' };

export default function Reports() {
  const { settings } = useSettings();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const currency = settings?.currency || 'PKR';

  const tabs = isAdmin ? [...REPORT_TABS, { id: 'all-stores', label: 'All Stores' }] : REPORT_TABS;

  const [tab, setTab] = useState('sales');
  const [period, setPeriod] = useState('daily');
  const [dailyDate, setDailyDate] = useState(todayStr);
  const [weeklyDate, setWeeklyDate] = useState(todayStr);
  const [monthlyMonth, setMonthlyMonth] = useState(currentMonthStr);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // ---- Sales Report tab: full Daily/Weekly/Monthly/Custom Range report ----
  const [salesDetail, setSalesDetail] = useState(null);
  const [salesDetailLoading, setSalesDetailLoading] = useState(true);

  const salesRange = useMemo(() => {
    if (period === 'daily') {
      return { startStr: dailyDate, endStr: dailyDate, label: formatDate(dailyDate) };
    }
    if (period === 'weekly') {
      const monday = startOfWeek(weeklyDate);
      const sunday = addDays(monday, 6);
      return {
        startStr: toDateStr(monday),
        endStr: toDateStr(sunday),
        label: `${formatDate(toDateStr(monday))} – ${formatDate(toDateStr(sunday))}`,
      };
    }
    if (period === 'monthly') {
      return { startStr: toDateStr(firstDayOfMonth(monthlyMonth)), endStr: toDateStr(lastDayOfMonth(monthlyMonth)), label: monthLabel(monthlyMonth) };
    }
    if (!customStart || !customEnd) return null;
    return { startStr: customStart, endStr: customEnd, label: `${formatDate(customStart)} – ${formatDate(customEnd)}` };
  }, [period, dailyDate, weeklyDate, monthlyMonth, customStart, customEnd]);

  const fetchSalesDetail = useCallback(async () => {
    if (!salesRange) {
      setSalesDetail(null);
      return;
    }
    setSalesDetailLoading(true);
    try {
      const { data } = await api.get('/reports/sales-detail', {
        // Whole-day bounds in UTC — the same boundary convention used by the
        // Dashboard's Today's Sales figure, so numbers never disagree.
        params: { from: `${salesRange.startStr}T00:00:00.000Z`, to: `${salesRange.endStr}T23:59:59.999Z` },
      });
      setSalesDetail(data.data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSalesDetailLoading(false);
    }
  }, [salesRange]);

  useEffect(() => {
    if (tab === 'sales') fetchSalesDetail();
  }, [tab, fetchSalesDetail]);

  // ---- Profit tab (Daily/Weekly/Monthly/Custom Range, same selector as the
  // Sales Report tab): per-product sales/profit breakdown, the window's
  // invoices, and summary totals, via the dedicated /reports/profit-detail
  // endpoint — mirrors fetchSalesDetail above.
  const [profitDetail, setProfitDetail] = useState(null);
  const [profitDetailLoading, setProfitDetailLoading] = useState(true);

  const fetchProfitDetail = useCallback(async () => {
    if (!salesRange) {
      setProfitDetail(null);
      return;
    }
    setProfitDetailLoading(true);
    try {
      const { data } = await api.get('/reports/profit-detail', {
        params: { from: `${salesRange.startStr}T00:00:00.000Z`, to: `${salesRange.endStr}T23:59:59.999Z` },
      });
      setProfitDetail(data.data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setProfitDetailLoading(false);
    }
  }, [salesRange]);

  useEffect(() => {
    if (tab === 'profit') fetchProfitDetail();
  }, [tab, fetchProfitDetail]);

  // ---- Every other tab: unchanged bucketed/aggregate reports ----
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);

  const isCustomRange = period === 'custom';
  // top-products keeps its original custom-range-only behavior.
  const customRangeApplies = ['top-products'].includes(tab);
  const dateRangeParams = isCustomRange && customRangeApplies && customStart && customEnd
    ? { from: customStart, to: `${customEnd}T23:59:59` }
    : {};

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      let data;
      if (tab === 'top-products') {
        ({ data } = await api.get('/reports/top-products', { params: { limit: 20, ...dateRangeParams } }));
      } else if (tab === 'stock') {
        ({ data } = await api.get('/reports/stock'));
      } else if (tab === 'all-stores') {
        ({ data } = await api.get('/reports/all-stores', { params: dateRangeParams }));
      } else {
        return;
      }
      setRows(data.data);
      setMeta(data.meta || null);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, customStart, customEnd]);

  useEffect(() => {
    if (tab !== 'sales' && tab !== 'profit') fetchReport();
  }, [tab, fetchReport]);

  const getExportData = () => {
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
    // tab === 'all-stores' (the only remaining case — 'sales'/'profit' use
    // their own dedicated multi-section exports below).
    return {
      title: 'All Stores Report',
      columns: ['Store', 'Type', 'Orders', 'Total Sales', 'Total Expenses', 'Net Profit'],
      rows: rows.map((r) => [r.store_name, r.is_main ? 'Main' : 'Sub', r.total_orders, r.total_sales, r.total_expenses, r.net_profit]),
    };
  };

  const getSalesDetailExportSections = () => {
    if (!salesDetail) return [];
    const { summary, productBreakdown, sales } = salesDetail;
    return [
      {
        title: 'Summary',
        columns: ['Metric', 'Value'],
        rows: [
          ['Total Sales', formatCurrency(summary.totalSales, currency)],
          ['Total Orders', summary.totalOrders],
          ['Items Sold', summary.totalItems],
          ['Quantity Sold', summary.totalQuantity],
          ['Total Paid', formatCurrency(summary.totalPaid, currency)],
          ['Total Pending', formatCurrency(summary.totalPending, currency)],
        ],
      },
      {
        title: 'Product-wise Breakdown',
        columns: ['Product', 'Quantity Sold', 'Avg. Selling Price', 'Total'],
        rows: productBreakdown.map((p) => [p.productName, p.quantity, formatCurrency(p.avgPrice, currency), formatCurrency(p.total, currency)]),
      },
      {
        title: 'Invoices',
        columns: ['Invoice #', 'Date', 'Time', 'Customer', 'Payment Method', 'Status', 'Subtotal', 'Discount', 'Total', 'Paid', 'Pending'],
        rows: sales.map((s) => [
          s.invoice_number,
          formatDate(s.created_at),
          new Date(s.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          s.customer_name || 'Walk-in Customer',
          s.payment_method,
          s.payment_status,
          formatCurrency(s.subtotal, currency),
          formatCurrency(s.discount, currency),
          formatCurrency(s.grand_total, currency),
          formatCurrency(s.paid_amount, currency),
          formatCurrency(s.remaining_balance, currency),
        ]),
      },
      {
        title: 'Sale Line Items',
        columns: ['Invoice #', 'Date', 'Product', 'Quantity', 'Selling Price', 'Line Total'],
        rows: sales.flatMap((s) =>
          s.items.map((item) => [
            s.invoice_number,
            formatDate(s.created_at),
            item.product_name,
            item.quantity,
            formatCurrency(item.unit_price, currency),
            formatCurrency(item.total, currency),
          ])
        ),
      },
    ];
  };

  // ---- Profit tab (any period): multi-section export (summary totals +
  // product breakdown + invoices), same pattern as getSalesDetailExportSections().
  const getProfitDetailExportSections = () => {
    if (!profitDetail) return [];
    const { summary, products, sales } = profitDetail;
    return [
      {
        title: 'Summary',
        columns: ['Metric', 'Value'],
        rows: [
          ['Total Invoices', summary.totalInvoices],
          ['Total Units Sold', summary.totalUnits],
          ['Total Sales', formatCurrency(summary.totalSales, currency)],
          ['Total Profit', formatCurrency(summary.totalProfit, currency)],
        ],
      },
      {
        title: 'Product-wise Sales & Profit',
        columns: ['Product', 'Units Sold', 'Sales Amount', 'Profit'],
        rows: products.map((p) => [p.productName, p.unitsSold, formatCurrency(p.salesAmount, currency), formatCurrency(p.profit, currency)]),
      },
      {
        title: 'Invoices',
        columns: ['Invoice #', 'Date', 'Customer', 'Payment Method', 'Status', 'Total'],
        rows: (sales || []).map((s) => [
          s.invoice_number,
          formatDateTime(s.created_at),
          s.customer_name || 'Walk-in Customer',
          s.payment_method,
          s.payment_status,
          formatCurrency(s.grand_total, currency),
        ]),
      },
    ];
  };

  const exportDisabled = tab === 'sales'
    ? !salesDetail || salesDetail.sales.length === 0
    : tab === 'profit'
    ? !profitDetail || profitDetail.products.length === 0
    : rows.length === 0;

  const handleExportPdf = () => {
    if (tab === 'sales') {
      if (!salesDetail) return;
      exportMultiSectionPdf(
        `${PERIOD_LABEL[period]} Sales Report`,
        salesRange?.label || '',
        getSalesDetailExportSections(),
        `sales-report-${period}`
      );
      return;
    }
    if (tab === 'profit') {
      if (!profitDetail) return;
      exportMultiSectionPdf(`${PERIOD_LABEL[period]} Profit Report`, salesRange?.label || '', getProfitDetailExportSections(), `profit-report-${period}`);
      return;
    }
    const { title, columns, rows: exportRows } = getExportData();
    exportReportToPdf(title, columns, exportRows, tab);
  };

  const handleExportExcel = () => {
    if (tab === 'sales') {
      if (!salesDetail) return;
      exportMultiSectionExcel(getSalesDetailExportSections(), `sales-report-${period}`);
      return;
    }
    if (tab === 'profit') {
      if (!profitDetail) return;
      exportMultiSectionExcel(getProfitDetailExportSections(), `profit-report-${period}`);
      return;
    }
    const { title, columns, rows: exportRows } = getExportData();
    exportReportToExcel(title, columns, exportRows, tab);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description={
          (tab === 'sales' || tab === 'profit') && salesRange
            ? `${PERIOD_LABEL[period]} Report — ${salesRange.label}`
            : 'Analyze sales, stock, and profitability'
        }
        actions={
          <>
            <Button variant="outline" className="border-primary/30 text-primary hover:bg-primary/5" onClick={handleExportPdf} disabled={exportDisabled}>
              <FileDown className="h-4 w-4" /> Export PDF
            </Button>
            <Button variant="outline" className="border-success/30 text-success hover:bg-success/5" onClick={handleExportExcel} disabled={exportDisabled}>
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

        {(tab === 'sales' || tab === 'profit') && (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>

            {period === 'daily' && (
              <input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} className={dateInputClass} aria-label="Date" />
            )}
            {period === 'weekly' && (
              <>
                <span className="text-xs text-muted-foreground">Week containing</span>
                <input type="date" value={weeklyDate} onChange={(e) => setWeeklyDate(e.target.value)} className={dateInputClass} aria-label="Date within week" />
              </>
            )}
            {period === 'monthly' && (
              <input type="month" value={monthlyMonth} onChange={(e) => setMonthlyMonth(e.target.value)} className={dateInputClass} aria-label="Month" />
            )}
            {period === 'custom' && (
              <>
                <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className={dateInputClass} aria-label="Start date" />
                <span className="text-xs text-muted-foreground">to</span>
                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className={dateInputClass} aria-label="End date" />
              </>
            )}
          </div>
        )}
      </div>

      {tab === 'sales' && salesDetail && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Total Sales</p>
            <p className="font-display mt-1 truncate text-lg font-bold text-primary">{formatCurrency(salesDetail.summary.totalSales, currency)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Orders</p>
            <p className="font-display mt-1 truncate text-lg font-bold text-purple">{salesDetail.summary.totalOrders}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Items Sold</p>
            <p className="font-display mt-1 truncate text-lg font-bold text-accent">{salesDetail.summary.totalItems}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Quantity Sold</p>
            <p className="font-display mt-1 truncate text-lg font-bold text-accent">{salesDetail.summary.totalQuantity}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Total Paid</p>
            <p className="font-display mt-1 truncate text-lg font-bold text-success">{formatCurrency(salesDetail.summary.totalPaid, currency)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Total Pending</p>
            <p className="font-display mt-1 truncate text-lg font-bold text-rose">{formatCurrency(salesDetail.summary.totalPending, currency)}</p>
          </Card>
        </div>
      )}

      {tab === 'profit' && profitDetail && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Total Invoices</p>
            <p className="font-display mt-1 truncate text-lg font-bold text-primary">{profitDetail.summary.totalInvoices}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Total Units Sold</p>
            <p className="font-display mt-1 truncate text-lg font-bold text-purple">{profitDetail.summary.totalUnits}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Total Sales</p>
            <p className="font-display mt-1 truncate text-lg font-bold text-accent">{formatCurrency(profitDetail.summary.totalSales, currency)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Total Profit</p>
            <p className="font-display mt-1 truncate text-lg font-bold text-success">{formatCurrency(profitDetail.summary.totalProfit, currency)}</p>
          </Card>
        </div>
      )}

      {meta && tab === 'stock' && (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Total Stock Value</p>
          <p className="font-display text-xl font-bold text-purple">{formatCurrency(meta.totalStockValue, currency)}</p>
        </Card>
      )}

      {meta && tab === 'all-stores' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4"><p className="text-sm text-muted-foreground">Total Sales</p><p className="font-display text-xl font-bold text-success">{formatCurrency(meta.totalSales, currency)}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">Total Orders</p><p className="font-display text-xl font-bold text-primary">{meta.totalOrders}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">Total Expenses</p><p className="font-display text-xl font-bold text-rose">{formatCurrency(meta.totalExpenses, currency)}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">Net Profit</p><p className="font-display text-xl font-bold text-success">{formatCurrency(meta.netProfit, currency)}</p></Card>
        </div>
      )}

      {tab === 'sales' ? (
        salesDetailLoading ? (
          <Card className="p-4"><TableSkeleton rows={6} cols={4} /></Card>
        ) : !salesDetail || salesDetail.sales.length === 0 ? (
          <Card className="p-4">
            <EmptyState icon={BarChart3} title="No sales in this range" description="Try a different date, week, month, or custom range." />
          </Card>
        ) : (
          <>
            <Card className="p-4">
              <h3 className="mb-3 font-display text-base font-bold">Product-wise Breakdown</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Quantity Sold</TableHead>
                    <TableHead>Avg. Selling Price</TableHead>
                    <TableHead>Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesDetail.productBreakdown.map((p) => (
                    <TableRow key={p.productName}>
                      <TableCell className="font-medium">{p.productName}</TableCell>
                      <TableCell><Badge variant="purple">{p.quantity}</Badge></TableCell>
                      <TableCell>{formatCurrency(p.avgPrice, currency)}</TableCell>
                      <TableCell className="font-semibold text-success">{formatCurrency(p.total, currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>

            <Card className="p-4">
              <h3 className="mb-3 font-display text-base font-bold">Invoices ({salesDetail.sales.length})</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Date &amp; Time</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesDetail.sales.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.invoice_number}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDateTime(s.created_at)}</TableCell>
                      <TableCell className="text-muted-foreground">{s.customer_name || 'Walk-in Customer'}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize">{s.payment_method.replace('_', ' ')}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={s.payment_status === 'paid' ? 'success' : s.payment_status === 'unpaid' ? 'destructive' : 'orange'} className="capitalize">
                          {s.payment_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-semibold text-primary">{formatCurrency(s.grand_total, currency)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => navigate(`/invoice/${s.id}`)} title="View invoice">
                          <Eye className="h-4 w-4 text-purple" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </>
        )
      ) : tab === 'profit' ? (
        profitDetailLoading ? (
          <Card className="p-4"><TableSkeleton rows={6} cols={4} /></Card>
        ) : !profitDetail || profitDetail.products.length === 0 ? (
          <Card className="p-4">
            <EmptyState icon={BarChart3} title="No sales in this range" description="Try a different date, week, month, or custom range." />
          </Card>
        ) : (
          <>
            <Card className="p-4">
              <h3 className="mb-3 font-display text-base font-bold">Product-wise Sales &amp; Profit</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Units Sold</TableHead>
                    <TableHead>Sales Amount</TableHead>
                    <TableHead>Profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profitDetail.products.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{p.productName}</TableCell>
                      <TableCell><Badge variant="purple">{p.unitsSold}</Badge></TableCell>
                      <TableCell className="text-primary">{formatCurrency(p.salesAmount, currency)}</TableCell>
                      <TableCell className="font-semibold text-success">{formatCurrency(p.profit, currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>

            <Card className="p-4">
              <h3 className="mb-3 font-display text-base font-bold">Invoices ({(profitDetail.sales || []).length})</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Date &amp; Time</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(profitDetail.sales || []).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.invoice_number}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDateTime(s.created_at)}</TableCell>
                      <TableCell className="text-muted-foreground">{s.customer_name || 'Walk-in Customer'}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize">{s.payment_method.replace('_', ' ')}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={s.payment_status === 'paid' ? 'success' : s.payment_status === 'unpaid' ? 'destructive' : 'orange'} className="capitalize">
                          {s.payment_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-semibold text-primary">{formatCurrency(s.grand_total, currency)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => navigate(`/invoice/${s.id}`)} title="View invoice">
                          <Eye className="h-4 w-4 text-purple" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </>
        )
      ) : (
        <Card className="p-4">
          {loading ? (
            <TableSkeleton rows={6} cols={5} />
          ) : rows.length === 0 ? (
            <EmptyState icon={BarChart3} title="No data available" description="Try a different period or check back after making some sales." />
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
                    <TableCell><Badge variant="purple">{r.units_sold}</Badge></TableCell>
                    <TableCell className="font-semibold text-success">{formatCurrency(r.revenue, currency)}</TableCell>
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
                    <TableCell className="font-semibold text-purple">{formatCurrency(r.stock_value, currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            // tab === 'all-stores' (the only remaining case — 'sales'/'profit'
            // are handled by their own branches above this generic Card).
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
                    <TableCell className="text-success">{formatCurrency(r.total_sales, currency)}</TableCell>
                    <TableCell className="text-rose">{formatCurrency(r.total_expenses, currency)}</TableCell>
                    <TableCell className="font-semibold text-success">{formatCurrency(r.net_profit, currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
