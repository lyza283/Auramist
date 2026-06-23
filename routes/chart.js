const express = require('express');
const router = express.Router();
const { addressChart, salesChart, itemsChart } = require('../controllers/chart');
const { isAuthenticatedUser, authorizeRoles } = require('../middlewares/auth');


router.get('/address-chart', isAuthenticatedUser, authorizeRoles('Admin'), addressChart);
router.get('/sales-chart', isAuthenticatedUser, authorizeRoles('Admin'), salesChart);
router.get('/items-chart', isAuthenticatedUser, authorizeRoles('Admin'), itemsChart);

module.exports = router;