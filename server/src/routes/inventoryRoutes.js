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

module.exports = router;
