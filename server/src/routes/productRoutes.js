const express = require('express');
const { body } = require('express-validator');
const productController = require('../controllers/productController');
const validate = require('../middleware/validate');
const { authenticate, requireRole, resolveStore } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.use(resolveStore);

const productValidation = [
  body('name').trim().notEmpty().withMessage('Product name is required'),
  body('sellingPrice').isFloat({ min: 0 }).withMessage('Selling price must be a positive number'),
  body('purchasePrice').isFloat({ min: 0 }).withMessage('Purchase price must be a positive number'),
];

router.get('/', productController.getProducts);
router.get('/barcode/:barcode', productController.getProductByBarcode);
router.get('/:id', productController.getProductById);

router.post('/', requireRole('admin'), productValidation, validate, productController.createProduct);
router.put('/:id', requireRole('admin'), productValidation, validate, productController.updateProduct);
router.delete('/:id', requireRole('admin'), productController.deleteProduct);

module.exports = router;
