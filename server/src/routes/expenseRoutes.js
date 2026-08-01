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

router.post(
  '/',
  [
    body('category').isIn(['food', 'transport', 'utilities', 'salaries', 'other']).withMessage('Invalid category'),
    body('amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
  ],
  validate,
  expenseController.createExpense
);

router.put(
  '/:id',
  [
    body('category').optional().isIn(['food', 'transport', 'utilities', 'salaries', 'other']),
    body('amount').optional().isFloat({ min: 0 }),
  ],
  validate,
  expenseController.updateExpense
);

router.delete('/:id', expenseController.deleteExpense);

module.exports = router;
