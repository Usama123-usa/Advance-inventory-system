const express = require('express');
const { body } = require('express-validator');
const tileOptionController = require('../controllers/tileOptionController');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

// Store managers need these dropdown lists (and to add new values to them)
// to fill out the Tiles product form for their own store; only admins may
// delete a shared option value since that affects every store's dropdowns.
router.get('/', requireRole('admin', 'store_manager'), tileOptionController.getTileOptions);

router.post(
  '/',
  requireRole('admin', 'store_manager'),
  [
    body('fieldName')
      .isIn(['size', 'glaze_mate', 'sqr_meter', 'packing_per_box', 'rate_per_meter'])
      .withMessage('Invalid field name'),
    body('value').trim().notEmpty().withMessage('Option value is required'),
  ],
  validate,
  tileOptionController.createTileOption
);

router.delete('/:id', requireRole('admin'), tileOptionController.deleteTileOption);

module.exports = router;
