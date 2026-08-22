const express = require('express');
const { body } = require('express-validator');
const expenseController = require('../controllers/expenseController');
const validate = require('../middleware/validate');
const { authenticate, resolveStore } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.use(resolveStore);

router.get('/', expenseController.getExpenses);
router.get('/summary', expenseController.getExpenseSummary);
router.get('/categories', expenseController.getExpenseCategories);

router.post(
  '/',
  [
    body('categories').isArray({ min: 1 }).withMessage('Select at least one expense category'),
    body('categories.*.categoryId').isUUID().withMessage('Every category needs a valid id'),
    body('categories.*.amount').isFloat({ min: 0 }).withMessage('Every category needs a valid amount'),
  ],
  validate,
  expenseController.createExpense
);

router.put(
  '/:id',
  [
    body('categories').optional().isArray({ min: 1 }).withMessage('Select at least one expense category'),
    body('categories.*.categoryId').optional().isUUID().withMessage('Every category needs a valid id'),
    body('categories.*.amount').optional().isFloat({ min: 0 }).withMessage('Every category needs a valid amount'),
  ],
  validate,
  expenseController.updateExpense
);

router.delete('/:id', expenseController.deleteExpense);

module.exports = router;
