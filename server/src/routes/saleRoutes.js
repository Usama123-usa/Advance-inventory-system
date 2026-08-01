const express = require('express');
const { body } = require('express-validator');
const saleController = require('../controllers/saleController');
const validate = require('../middleware/validate');
const { authenticate, resolveStore } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.use(resolveStore);

router.get('/', saleController.getSales);
router.get('/pending-payments', saleController.getPendingPayments);
router.get('/:id', saleController.getSaleById);

router.post(
  '/',
  [
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
    body('paymentMethod').optional().isIn(['cash', 'card', 'bank_transfer']),
    body('paidAmount').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }),
  ],
  validate,
  saleController.createSale
);

module.exports = router;
