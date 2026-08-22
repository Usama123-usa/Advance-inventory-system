const express = require('express');
const { body } = require('express-validator');
const saleController = require('../controllers/saleController');
const validate = require('../middleware/validate');
const { authenticate, requireRole, resolveStore } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.use(resolveStore);

router.get('/', saleController.getSales);
router.get('/pending-payments', saleController.getPendingPayments);

router.post(
  '/pending-payments',
  [
    body('customerName').trim().notEmpty().withMessage('Customer name is required'),
    body('customerPhone').trim().notEmpty().withMessage('Customer phone is required'),
    body('customerAddress').optional({ nullable: true }).isString().trim(),
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be greater than zero'),
    body('paymentDate').optional({ nullable: true }).isISO8601(),
  ],
  validate,
  saleController.createPendingCustomer
);

router.get('/pending-payments/:id/history', saleController.getPendingPaymentHistory);

router.put(
  '/pending-payments/:id',
  [
    body('customerName').optional({ nullable: true }).isString().trim(),
    body('customerPhone').optional({ nullable: true }).isString().trim(),
    body('customerAddress').optional({ nullable: true }).isString().trim(),
    body('totalRemainingBalance').optional({ nullable: true }).isFloat({ min: 0 }),
  ],
  validate,
  saleController.updatePendingPayment
);

router.post(
  '/pending-payments/:id/payment',
  [
    body('amount').isFloat({ gt: 0 }).withMessage('Payment amount must be greater than zero'),
    body('paymentDate').optional({ nullable: true }).isISO8601(),
  ],
  validate,
  saleController.receivePendingPayment
);

router.delete('/pending-payments/:id', requireRole('admin'), saleController.deletePendingPayment);

router.get('/:id', saleController.getSaleById);
router.delete('/:id', requireRole('admin'), saleController.deleteSale);

router.post(
  '/:id/return',
  [
    body('items').isArray({ min: 1 }).withMessage('Select at least one product to return'),
    body('items.*.saleItemId').isUUID().withMessage('Valid line item is required for every returned product'),
    body('items.*.quantity').isFloat({ gt: 0 }).withMessage('Quantity must be greater than 0 for every item'),
    body('reason').optional({ nullable: true }).isString().trim(),
  ],
  validate,
  saleController.createSaleReturn
);

router.post(
  '/',
  [
    body('invoiceNumber').trim().notEmpty().withMessage('Invoice number is required').isLength({ max: 40 }).withMessage('Invoice number is too long'),
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
    body('items.*.unitPrice').isFloat({ min: 0 }).withMessage('Every item needs a valid selling price'),
    body('discount').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }).withMessage('Discount cannot be negative'),
    body('paymentMethod').optional().isIn(['cash', 'card', 'bank_transfer']),
    body('paidAmount').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }),
  ],
  validate,
  saleController.createSale
);

module.exports = router;
