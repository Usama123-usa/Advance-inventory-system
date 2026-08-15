import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

export function exportReportToPdf(title, columns, rows, filename) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 40, 40);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated on ${new Date().toLocaleString()}`, 40, 56);

  autoTable(doc, {
    startY: 70,
    head: [columns],
    body: rows,
    theme: 'striped',
    headStyles: { fillColor: [37, 99, 235] },
    styles: { fontSize: 9 },
    margin: { left: 40, right: 40 },
  });

  doc.save(`${filename}.pdf`);
}

export function exportReportToExcel(sheetName, columns, rows, filename) {
  const worksheet = XLSX.utils.aoa_to_sheet([columns, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

// Multi-section export for reports made of several distinct tables (e.g. a
// summary, a product breakdown, and an invoice list) that don't fit one flat
// grid — each section gets its own table (PDF, stacked vertically) or its
// own sheet (Excel). `sections` is [{ title, columns, rows }, ...].
export function exportMultiSectionPdf(title, subtitle, sections, filename) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 40, 40);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(subtitle || `Generated on ${new Date().toLocaleString()}`, 40, 56);

  let y = 74;
  sections.forEach((section) => {
    if (!section.rows.length) return;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(section.title, 40, y);
    autoTable(doc, {
      startY: y + 6,
      head: [section.columns],
      body: section.rows,
      theme: 'striped',
      headStyles: { fillColor: [37, 99, 235] },
      styles: { fontSize: 8 },
      margin: { left: 40, right: 40 },
    });
    y = doc.lastAutoTable.finalY + 24;
    if (y > 760) {
      doc.addPage();
      y = 40;
    }
  });

  doc.save(`${filename}.pdf`);
}

export function exportMultiSectionExcel(sections, filename) {
  const workbook = XLSX.utils.book_new();
  sections.forEach((section) => {
    if (!section.rows.length) return;
    const worksheet = XLSX.utils.aoa_to_sheet([section.columns, ...section.rows]);
    // Sheet names are capped at 31 chars and can't contain certain characters.
    const sheetName = section.title.replace(/[\\/?*[\]:]/g, '').slice(0, 31);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  });
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}
