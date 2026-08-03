import { useEffect, useState, memo } from 'react';
import {
  Package,
  Tags,
  AlertTriangle,
  CalendarDays,
  TrendingUp,
  DollarSign,
  Wallet,
  CalendarRange,
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
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDateTime } from '@/lib/utils';

const compactNumber = (value) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value) || 0);

// Custom tooltip: value leads (bold, high-contrast), date follows (muted) —
// matches the app's card chrome instead of recharts' generic default box.
function SalesTrendTooltip({ active, payload, label, currency }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
      <p className="text-xs text-muted-foreground">
        {new Date(label).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-foreground">{formatCurrency(payload[0].value, currency)}</p>
    </div>
  );
}

// Marks only the last point so the series ends on a visible anchor instead of
// trailing off into the fill; every other index renders nothing.
function makeEndDot(lastIndex) {
  return function EndDot({ cx, cy, index }) {
    if (index !== lastIndex) return null;
    return <circle key="end-dot" cx={cx} cy={cy} r={5} fill="hsl(var(--primary))" stroke="hsl(var(--card))" strokeWidth={2} />;
  };
}

// Each panel only re-renders when its own slice of dashboard data changes,
// not on every Dashboard render.
const SalesTrendChart = memo(function SalesTrendChart({ trend, currency }) {
  if (trend.length === 0) {
    return <EmptyState title="No sales yet" description="Daily sales will chart here once orders come in." />;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={trend} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
        <XAxis
          dataKey="date"
          tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          minTickGap={24}
          stroke="hsl(var(--muted-foreground))"
        />
        <YAxis
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={40}
          tickMargin={8}
          tickFormatter={compactNumber}
          stroke="hsl(var(--muted-foreground))"
        />
        <Tooltip
          content={<SalesTrendTooltip currency={currency} />}
          cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
        />
        <Area
          type="monotone"
          dataKey="total"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          strokeLinecap="round"
          fill="url(#colorTotal)"
          dot={makeEndDot(trend.length - 1)}
          activeDot={{ r: 5, fill: 'hsl(var(--primary))', stroke: 'hsl(var(--card))', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
});

const BestSellingList = memo(function BestSellingList({ bestSelling, currency }) {
  if (bestSelling.length === 0) {
    return <EmptyState title="No sales yet" description="Best sellers will appear here." />;
  }
  return (
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
  );
});

const RecentSalesList = memo(function RecentSalesList({ recentSales, currency }) {
  if (recentSales.length === 0) {
    return <EmptyState title="No sales recorded yet" description="Completed sales will show up here." />;
  }
  return (
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
  );
});

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
    // Single combined request — the backend runs all 4 underlying queries
    // in parallel and returns them together instead of 4 separate round trips.
    api
      .get('/dashboard', { params: { days: 14, recentLimit: 6, bestSellingLimit: 5 } })
      .then(({ data }) => {
        if (!active) return;
        setSummary(data.data.summary);
        setTrend(data.data.salesTrend);
        setRecentSales(data.data.recentSales);
        setBestSelling(data.data.bestSelling);
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

  const currency = settings?.currency || 'PKR';

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Overview of your store's performance" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        <StatCard
          label="Today's Expenses"
          value={formatCurrency(summary.todayExpenses, currency)}
          icon={Wallet}
          iconClassName="bg-destructive/10 text-destructive"
        />
        <StatCard
          label="This Month's Expenses"
          value={formatCurrency(summary.monthlyExpenses, currency)}
          icon={CalendarRange}
          iconClassName="bg-destructive/10 text-destructive"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Sales Trend</CardTitle>
              <CardDescription>Last 14 days</CardDescription>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-sm font-semibold text-foreground">
                {formatCurrency(trend.reduce((sum, t) => sum + Number(t.total || 0), 0), currency)}
              </p>
            </div>
          </CardHeader>
          <CardContent className="pl-0">
            <SalesTrendChart trend={trend} currency={currency} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Best Selling Products</CardTitle>
          </CardHeader>
          <CardContent>
            <BestSellingList bestSelling={bestSelling} currency={currency} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Sales</CardTitle>
        </CardHeader>
        <CardContent>
          <RecentSalesList recentSales={recentSales} currency={currency} />
        </CardContent>
      </Card>
    </div>
  );
}
