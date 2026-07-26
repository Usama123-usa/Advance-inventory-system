import { useEffect, useState } from 'react';
import {
  Package,
  Tags,
  AlertTriangle,
  CalendarDays,
  TrendingUp,
  DollarSign,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import api from '@/lib/api';
import { useSettings } from '@/context/SettingsContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDateTime } from '@/lib/utils';

export default function Dashboard() {
  const { settings } = useSettings();
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [recentSales, setRecentSales] = useState([]);
  const [bestSelling, setBestSelling] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      api.get('/dashboard/summary'),
      api.get('/dashboard/sales-trend', { params: { days: 14 } }),
      api.get('/dashboard/recent-sales', { params: { limit: 6 } }),
      api.get('/dashboard/best-selling', { params: { limit: 5 } }),
    ])
      .then(([s, t, r, b]) => {
        if (!active) return;
        setSummary(s.data.data);
        setTrend(t.data.data);
        setRecentSales(r.data.data);
        setBestSelling(b.data.data);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  const currency = settings?.currency || 'USD';

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Overview of your store's performance" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total Products" value={summary.totalProducts} icon={Package} />
        <StatCard label="Total Categories" value={summary.totalCategories} icon={Tags} />
        <StatCard
          label="Low Stock Items"
          value={summary.lowStockItems}
          icon={AlertTriangle}
          iconClassName="bg-warning/10 text-warning"
        />
        <StatCard
          label="Today's Sales"
          value={formatCurrency(summary.todaySales.total, currency)}
          trendLabel={`${summary.todaySales.count} orders today`}
          icon={CalendarDays}
        />
        <StatCard
          label="Monthly Sales"
          value={formatCurrency(summary.monthlySales.total, currency)}
          trendLabel={`${summary.monthlySales.count} orders this month`}
          icon={TrendingUp}
        />
        <StatCard
          label="Total Revenue"
          value={formatCurrency(summary.totalRevenue, currency)}
          icon={DollarSign}
          iconClassName="bg-success/10 text-success"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Sales Trend (Last 14 Days)</CardTitle>
          </CardHeader>
          <CardContent className="pl-0">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={trend} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis fontSize={12} tickLine={false} axisLine={false} width={40} />
                <Tooltip
                  formatter={(value) => formatCurrency(value, currency)}
                  labelFormatter={(v) => new Date(v).toLocaleDateString()}
                  contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))', fontSize: 13 }}
                />
                <Area type="monotone" dataKey="total" stroke="hsl(var(--primary))" fill="url(#colorTotal)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Best Selling Products</CardTitle>
          </CardHeader>
          <CardContent>
            {bestSelling.length === 0 ? (
              <EmptyState title="No sales yet" description="Best sellers will appear here." />
            ) : (
              <div className="space-y-4">
                {bestSelling.map((p, i) => (
                  <div key={p.id} className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.units_sold} units sold</p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold">{formatCurrency(p.revenue, currency)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Sales</CardTitle>
        </CardHeader>
        <CardContent>
          {recentSales.length === 0 ? (
            <EmptyState title="No sales recorded yet" description="Completed sales will show up here." />
          ) : (
            <div className="divide-y divide-border">
              {recentSales.map((sale) => (
                <div key={sale.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="text-sm font-medium">{sale.invoice_number}</p>
                    <p className="text-xs text-muted-foreground">
                      {sale.customer_name} · {formatDateTime(sale.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="capitalize">
                      {sale.payment_method.replace('_', ' ')}
                    </Badge>
                    <p className="font-semibold">{formatCurrency(sale.grand_total, currency)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
