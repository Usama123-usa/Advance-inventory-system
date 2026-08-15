import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatCurrency, formatDate } from './utils';

export function generatePaymentHistoryPdf(customer, history, settings) {
  const currency = settings?.currency || 'PKR';
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 40;
  let y = 50;

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(settings?.shop_name || 'My Shop', marginX, y);

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('PAYMENT HISTORY', 555, 50, { align: 'right' });

  y += 30;
  doc.setDrawColor(220);
  doc.line(marginX, y, 555, y);
  y += 20;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Customer:', marginX, y);
  doc.setFont('helvetica', 'normal');
  y += 14;
  doc.text(customer.customer_name || 'Unknown', marginX, y);
  if (customer.customer_phone) { y += 14; doc.text(customer.customer_phone, marginX, y); }
  if (customer.customer_address) { y += 14; doc.text(customer.customer_address, marginX, y); }

  y += 20;
  doc.setFont('helvetica', 'bold');
  doc.text(`Remaining Balance: ${formatCurrency(customer.total_remaining_balance, currency)}`, marginX, y);

  y += 20;

  autoTable(doc, {
    startY: y,
    head: [['Date', 'Type', 'Amount', 'Notes']],
    body: history.map((row) => [
      formatDate(row.payment_date),
      row.entry_type === 'charge' ? 'Charge' : 'Payment Received',
      formatCurrency(row.amount, currency),
      row.notes || '—',
    ]),
    theme: 'striped',
    headStyles: { fillColor: [37, 99, 235] },
    margin: { left: marginX, right: 40 },
    styles: { fontSize: 10 },
  });

  doc.save(`payment-history-${(customer.customer_name || 'customer').replace(/\s+/g, '-')}.pdf`);
}
