const express = require('express');
const dashboardController = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/summary', dashboardController.getSummary);
router.get('/recent-sales', dashboardController.getRecentSales);
router.get('/best-selling', dashboardController.getBestSelling);
router.get('/sales-trend', dashboardController.getSalesTrend);

module.exports = router;
