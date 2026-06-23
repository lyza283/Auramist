const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/category');
const { isAuthenticatedUser, authorizeRoles } = require('../middlewares/auth');

router.get('/', categoryController.getAllCategories);
router.get('/admin/all', categoryController.getAllCategoriesWithDeleted);

router.get('/', isAuthenticatedUser, authorizeRoles('Admin'), categoryController.getAllCategories);
router.post('/', isAuthenticatedUser, authorizeRoles('Admin'), categoryController.createCategory);
router.put('/restore/:id', isAuthenticatedUser, authorizeRoles('Admin'), categoryController.restoreCategory);
router.get('/:id', isAuthenticatedUser, authorizeRoles('Admin'), categoryController.getSingleCategory);
router.put('/:id', isAuthenticatedUser, authorizeRoles('Admin'), categoryController.updateCategory);
router.delete('/:id', isAuthenticatedUser, authorizeRoles('Admin'), categoryController.deleteCategory);

module.exports = router;

