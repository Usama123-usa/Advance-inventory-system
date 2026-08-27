const express = require('express');
const { body } = require('express-validator');
const categoryController = require('../controllers/categoryController');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/', categoryController.getCategories);
router.get('/:id', categoryController.getCategoryById);

const categoryValidation = [
  body('name').trim().notEmpty().withMessage('Category name is required'),
  body('type').isIn(['tiles', 'other']).withMessage('Category type must be "tiles" or "other"'),
];

router.post('/', categoryValidation, validate, categoryController.createCategory);

router.put('/:id', categoryValidation, validate, categoryController.updateCategory);

router.delete('/:id', categoryController.deleteCategory);
router.post('/bulk-delete', categoryController.bulkDeleteCategories);

module.exports = router;
