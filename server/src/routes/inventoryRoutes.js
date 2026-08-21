const express = require('express');
const { body } = require('express-validator');
const inventoryController = require('../controllers/inventoryController');
const validate = require('../middleware/validate');
const { authenticate, resolveStore } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.use(resolveStore);

router.get('/current', inventoryController.getCurrentStock);
router.get('/low-stock', inventoryController.getLowStock);
router.get('/history', inventoryController.getHistory);
router.get('/stock-returns', inventoryController.getStockReturns);

router.post(
  '/stock-in',
  [body('productId').isUUID().withMessage('Valid productId is required'), body('quantity').isFloat({ gt: 0 })],
  validate,
  inventoryController.stockIn
);

router.post(
  '/stock-out',
  [body('productId').isUUID().withMessage('Valid productId is required'), body('quantity').isFloat({ gt: 0 })],
  validate,
  inventoryController.stockOut
);

router.post(
  '/stock-return',
  [
    body('items').isArray({ min: 1 }).withMessage('Select at least one product to return'),
    body('items.*.productId').isUUID().withMessage('Valid productId is required for every item'),
    body('items.*.quantity').isFloat({ gt: 0 }).withMessage('Quantity must be greater than 0 for every item'),
  ],
  validate,
  inventoryController.createStockReturn
);

module.exports = router;
