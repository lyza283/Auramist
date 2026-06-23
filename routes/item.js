const express = require('express');
const router = express.Router();
const itemController = require('../controllers/item');
const upload = require('../middlewares/upload');
const { isAuthenticatedUser, authorizeRoles } = require('../middlewares/auth');

// PUBLIC ROUTES (no authentication required)
router.get('/', itemController.getAllItems);
router.get('/search/:term', itemController.searchItems);

// ADMIN ROUTES (require authentication and admin role)
router.get('/admin', isAuthenticatedUser, authorizeRoles('Admin'), itemController.getAllItemsIncludingDeleted);
router.get('/admin/:id', isAuthenticatedUser, authorizeRoles('Admin'), itemController.getSingleItem);
router.post('/admin', isAuthenticatedUser, authorizeRoles('Admin'), upload.array('images', 5), itemController.createItem);
router.put('/admin/:id', isAuthenticatedUser, authorizeRoles('Admin'), upload.array('images', 5), itemController.updateItem);
router.delete('/admin/:id', isAuthenticatedUser, authorizeRoles('Admin'), itemController.deleteItem);
router.patch('/admin/restore/:id', isAuthenticatedUser, authorizeRoles('Admin'), itemController.restoreItem);
router.get('/admin/all', isAuthenticatedUser, authorizeRoles('Admin'), itemController.getAllItemsIncludingDeleted);

module.exports = router;