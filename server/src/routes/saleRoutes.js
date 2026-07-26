const express = require('express');
const { body } = require('express-validator');
const saleController = require('../controllers/saleController');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/', saleController.getSales);
router.get('/:id', saleController.getSaleById);

router.post(
  '/',
  [
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
    body('paymentMethod').optional().isIn(['cash', 'card', 'bank_transfer']),
  ],
  validate,
  saleController.createSale
);

module.exports = router;
