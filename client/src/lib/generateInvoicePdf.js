import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatCurrency, formatDateTime } from './utils';

export function generateInvoicePdf(sale, settings) {
  const currency = settings?.currency || 'PKR';
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 40;
  let y = 50;

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(settings?.shop_name || 'My Shop', marginX, y);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  y += 18;
  if (settings?.address) { doc.text(settings.address, marginX, y); y += 14; }
  if (settings?.phone) { doc.text(`Phone: ${settings.phone}`, marginX, y); y += 14; }
  if (settings?.email) { doc.text(`Email: ${settings.email}`, marginX, y); y += 14; }

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('INVOICE', 555, 50, { align: 'right' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Invoice #: ${sale.invoice_number}`, 555, 68, { align: 'right' });
  doc.text(`Date: ${formatDateTime(sale.created_at)}`, 555, 82, { align: 'right' });
  doc.text(`Payment: ${sale.payment_method.replace('_', ' ')}`, 555, 96, { align: 'right' });

  y = Math.max(y, 110) + 20;
  doc.setDrawColor(220);
  doc.line(marginX, y, 555, y);
  y += 20;

  doc.setFont('helvetica', 'bold');
  doc.text('Billed To:', marginX, y);
  doc.setFont('helvetica', 'normal');
  y += 14;
  doc.text(sale.customer_name || 'Walk-in Customer', marginX, y);
  if (sale.customer_phone) { y += 14; doc.text(sale.customer_phone, marginX, y); }
  if (sale.customer_address) { y += 14; doc.text(sale.customer_address, marginX, y); }
  if (sale.customer_cnic) { y += 14; doc.text(`CNIC: ${sale.customer_cnic}`, marginX, y); }
  if (sale.customer_email) { y += 14; doc.text(sale.customer_email, marginX, y); }

  y += 20;

  autoTable(doc, {
    startY: y,
    head: [['Product', 'Qty', 'Unit Price', 'Total']],
    body: sale.items.map((item) => {
      const totalMeters = item.sqr_meter ? Number((item.sqr_meter * item.quantity).toFixed(3)) : null;
      const nameLine =
        totalMeters != null && item.rate_per_meter != null
          ? `${item.product_name}\n${totalMeters} m2 x ${formatCurrency(item.rate_per_meter, currency)}/m2`
          : item.product_name;
      return [nameLine, item.quantity, formatCurrency(item.unit_price, currency), formatCurrency(item.total, currency)];
    }),
    theme: 'striped',
    headStyles: { fillColor: [37, 99, 235] },
    margin: { left: marginX, right: 40 },
    styles: { fontSize: 10 },
  });

  let finalY = doc.lastAutoTable.finalY + 20;

  const summaryRows = [
    ['Subtotal', formatCurrency(sale.subtotal, currency)],
    ['Discount', `- ${formatCurrency(sale.discount, currency)}`],
    ['Tax', formatCurrency(sale.tax, currency)],
    ['Total Amount', formatCurrency(sale.grand_total, currency)],
    ['Amount Paid', formatCurrency(sale.paid_amount, currency)],
  ];

  if (Number(sale.remaining_balance) > 0) {
    summaryRows.push(['Remaining Balance', formatCurrency(sale.remaining_balance, currency)]);
  }
  summaryRows.push(['Payment Status', String(sale.payment_status || '').toUpperCase()]);

  const totalRowIndex = summaryRows.findIndex(([label]) => label === 'Total Amount');

  summaryRows.forEach(([label, value], i) => {
    const isTotal = i === totalRowIndex;
    doc.setFont('helvetica', isTotal ? 'bold' : 'normal');
    doc.setFontSize(isTotal ? 12 : 10);
    doc.text(label, 420, finalY, { align: 'left' });
    doc.text(value, 555, finalY, { align: 'right' });
    finalY += 18;
  });

  finalY += 20;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.text(settings?.invoice_footer || 'Thank you for your business!', marginX, finalY);

  doc.save(`${sale.invoice_number}.pdf`);
}
