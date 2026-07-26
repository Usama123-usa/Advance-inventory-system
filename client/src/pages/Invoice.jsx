import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Printer, Download, ArrowLeft, ShoppingCart, Store } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import { useSettings } from '@/context/SettingsContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { generateInvoicePdf } from '@/lib/generateInvoicePdf';
import { formatCurrency, formatDateTime } from '@/lib/utils';

export default function Invoice() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [sale, setSale] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get(`/sales/${id}`)
      .then(({ data }) => setSale(data.data))
      .catch((err) => toast.error(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!sale) return null;

  const currency = settings?.currency || 'USD';

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <Button variant="ghost" onClick={() => navigate('/pos')}>
          <ArrowLeft className="h-4 w-4" /> Back to POS
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button onClick={() => generateInvoicePdf(sale, settings)}>
            <Download className="h-4 w-4" /> Download PDF
          </Button>
          <Link to="/pos">
            <Button variant="secondary"><ShoppingCart className="h-4 w-4" /> New Sale</Button>
          </Link>
        </div>
      </div>

      <Card className="p-8 print:border-0 print:shadow-none">
        <div className="flex items-start justify-between border-b border-border pb-6">
          <div className="flex items-center gap-3">
            {settings?.logo_url ? (
              <img src={settings.logo_url} alt="Logo" className="h-12 w-12 rounded-lg object-cover" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-primary-foreground">
                <Store className="h-6 w-6" />
              </div>
            )}
            <div>
              <h1 className="text-lg font-bold">{settings?.shop_name || 'My Shop'}</h1>
              {settings?.address && <p className="text-xs text-muted-foreground">{settings.address}</p>}
              {settings?.phone && <p className="text-xs text-muted-foreground">{settings.phone}</p>}
              {settings?.email && <p className="text-xs text-muted-foreground">{settings.email}</p>}
            </div>
          </div>
          <div className="text-right">
            <h2 className="text-xl font-bold text-primary">INVOICE</h2>
            <p className="mt-1 text-sm text-muted-foreground">#{sale.invoice_number}</p>
            <p className="text-sm text-muted-foreground">{formatDateTime(sale.created_at)}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 py-6">
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Billed To</p>
            <p className="mt-1 font-medium">{sale.customer_name || 'Walk-in Customer'}</p>
            {sale.customer_phone && <p className="text-sm text-muted-foreground">{sale.customer_phone}</p>}
            {sale.customer_email && <p className="text-sm text-muted-foreground">{sale.customer_email}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Payment Method</p>
            <p className="mt-1 font-medium capitalize">{sale.payment_method.replace('_', ' ')}</p>
            <p className="text-sm text-muted-foreground">Cashier: {sale.cashier_name}</p>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <th className="py-2">Product</th>
              <th className="py-2 text-center">Qty</th>
              <th className="py-2 text-right">Price</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sale.items.map((item) => (
              <tr key={item.id}>
                <td className="py-2.5">{item.product_name}</td>
                <td className="py-2.5 text-center">{item.quantity}</td>
                <td className="py-2.5 text-right">{formatCurrency(item.unit_price, currency)}</td>
                <td className="py-2.5 text-right font-medium">{formatCurrency(item.total, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(sale.subtotal, currency)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>- {formatCurrency(sale.discount, currency)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{formatCurrency(sale.tax, currency)}</span></div>
            <div className="flex justify-between border-t border-border pt-2 text-base font-bold"><span>Grand Total</span><span className="text-primary">{formatCurrency(sale.grand_total, currency)}</span></div>
          </div>
        </div>

        <p className="mt-8 border-t border-border pt-4 text-center text-xs italic text-muted-foreground">
          {settings?.invoice_footer || 'Thank you for your business!'}
        </p>
      </Card>
    </div>
  );
}
