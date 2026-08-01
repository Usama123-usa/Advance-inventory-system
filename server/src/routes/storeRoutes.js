const express = require('express');
const { body } = require('express-validator');
const storeController = require('../controllers/storeController');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('admin'));

router.get('/', storeController.getStores);
router.get('/:id', storeController.getStoreById);

router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Store name is required'),
    body('managerEmail').isEmail().withMessage('A valid manager email is required'),
    body('managerPassword').isLength({ min: 6 }).withMessage('Manager password must be at least 6 characters'),
  ],
  validate,
  storeController.createStore
);

router.put('/:id', storeController.updateStore);
router.delete('/:id', storeController.deleteStore);

module.exports = router;
