const express = require('express');
const settingsController = require('../controllers/settingsController');
const { authenticate, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

router.use(authenticate);

router.get('/', settingsController.getSettings);
router.put('/', requireRole('admin'), settingsController.updateSettings);
router.post('/logo', requireRole('admin'), upload.single('logo'), settingsController.uploadLogo);

module.exports = router;
