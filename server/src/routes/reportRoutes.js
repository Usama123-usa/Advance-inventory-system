const express = require('express');
const reportController = require('../controllers/reportController');
const { authenticate, requireRole, resolveStore } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('admin'));

// Registered before resolveStore since it isn't scoped to a single store.
router.get('/all-stores', reportController.getAllStoresReport);

router.use(resolveStore);

router.get('/sales', reportController.getSalesReport);
router.get('/sales-detail', reportController.getSalesDetailReport);
router.get('/expenses', reportController.getExpenseReport);
router.get('/pending-payments', reportController.getPendingPaymentReport);
router.get('/profit', reportController.getProfitReport);
router.get('/profit-detail', reportController.getProfitDetailReport);

module.exports = router;
