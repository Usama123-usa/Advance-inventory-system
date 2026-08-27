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
  body('purchasePrice').isFloat({ min: 0 }).withMessage('Purchase price must be a positive number'),
];

router.get('/', productController.getProducts);
router.get('/barcode/:barcode', productController.getProductByBarcode);
router.get('/:id', productController.getProductById);

// Store managers can add/edit products for their own sub-store; only admins
// may delete a product outright (it's a global catalog entry shared by every store).
router.post('/', requireRole('admin', 'store_manager'), productValidation, validate, productController.createProduct);
router.put('/:id', requireRole('admin', 'store_manager'), productValidation, validate, productController.updateProduct);
router.delete('/:id', requireRole('admin'), productController.deleteProduct);
router.post('/bulk-delete', requireRole('admin'), productController.bulkDeleteProducts);

module.exports = router;
