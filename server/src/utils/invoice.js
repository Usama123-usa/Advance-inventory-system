// Generates a human-readable, sortable invoice number, e.g. INV-20260726-0F3A9C
const generateInvoiceNumber = () => {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `INV-${datePart}-${randomPart}`;
};

module.exports = { generateInvoiceNumber };
