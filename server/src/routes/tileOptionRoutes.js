const express = require('express');
const { body } = require('express-validator');
const tileOptionController = require('../controllers/tileOptionController');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('admin'));

router.get('/', tileOptionController.getTileOptions);

router.post(
  '/',
  [
    body('fieldName')
      .isIn(['size', 'glaze_mate', 'sqr_meter', 'packing_per_box', 'rate_per_meter'])
      .withMessage('Invalid field name'),
    body('value').trim().notEmpty().withMessage('Option value is required'),
  ],
  validate,
  tileOptionController.createTileOption
);

router.delete('/:id', tileOptionController.deleteTileOption);

module.exports = router;
