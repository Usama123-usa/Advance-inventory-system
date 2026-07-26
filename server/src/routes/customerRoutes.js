const express = require('express');
const { body } = require('express-validator');
const customerController = require('../controllers/customerController');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/', customerController.getCustomers);
router.get('/:id', customerController.getCustomerById);
router.get('/:id/purchases', customerController.getCustomerPurchases);

router.post(
  '/',
  [body('name').trim().notEmpty().withMessage('Customer name is required')],
  validate,
  customerController.createCustomer
);

router.put(
  '/:id',
  [body('name').trim().notEmpty().withMessage('Customer name is required')],
  validate,
  customerController.updateCustomer
);

router.delete('/:id', customerController.deleteCustomer);

module.exports = router;
