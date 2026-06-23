const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order');
const { isAuthenticatedUser, authorizeRoles } = require('../middlewares/auth');

// Create a new order
router.post('/', orderController.createOrder);

// Get orders by customer ID
router.get('/customer/:customerId', orderController.getOrdersByCustomer);
router.get('/shipping', orderController.getShippingOptions);

// Admin
router.get('/admin', isAuthenticatedUser, authorizeRoles('Admin'), orderController.getAllOrders);
router.get('/admin/:orderId', isAuthenticatedUser, authorizeRoles('Admin'), orderController.getOrderById);
router.put('/admin/:orderId/status', isAuthenticatedUser, authorizeRoles('Admin'), orderController.updateOrderStatus);
router.delete('/admin/:orderId/delete', isAuthenticatedUser, authorizeRoles('Admin'), orderController.softDeleteOrder);
router.put('/admin/:orderId/restore', isAuthenticatedUser, authorizeRoles('Admin'), orderController.restoreOrder);

module.exports = router;
