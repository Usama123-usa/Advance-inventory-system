const express = require('express');
const { body } = require('express-validator');
const userController = require('../controllers/userController');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('admin'));

router.get('/', userController.getUsers);

router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('A valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').optional().isIn(['admin', 'staff', 'store_manager']),
    body('storeId').optional({ nullable: true }).isUUID(),
  ],
  validate,
  userController.createUser
);

router.put(
  '/:id',
  [
    body('name').optional().trim().notEmpty(),
    body('email').optional().isEmail(),
    body('role').optional().isIn(['admin', 'staff', 'store_manager']),
    body('storeId').optional({ nullable: true }).isUUID(),
    body('isActive').optional().isBoolean(),
  ],
  validate,
  userController.updateUser
);

router.patch(
  '/:id/reset-password',
  [body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')],
  validate,
  userController.resetPassword
);

router.delete('/:id', userController.deleteUser);

module.exports = router;
