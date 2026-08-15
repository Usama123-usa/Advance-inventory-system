const express = require('express');
const reportController = require('../controllers/reportController');
const { authenticate, requireRole, resolveStore } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

// Admin-only combined view — registered before resolveStore since it isn't
// scoped to a single store.
router.get('/all-stores', requireRole('admin'), reportController.getAllStoresReport);

router.use(resolveStore);

router.get('/sales', reportController.getSalesReport);
router.get('/sales-detail', reportController.getSalesDetailReport);
router.get('/top-products', reportController.getTopProducts);
router.get('/stock', reportController.getStockReport);
router.get('/profit', reportController.getProfitReport);

module.exports = router;
