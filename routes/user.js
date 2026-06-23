const express = require('express');
const router = express.Router();
const upload = require('../utils/multer')
const { isAuthenticatedUser, authorizeRoles } = require('../middlewares/auth');

const { registerUser, loginUser, updateUser, deactivateUser, getCustomerProfile, 
    updateUserRole, updateUserStatus, getAllUsers, getSingleUser, createAdmin } = require('../controllers/user')

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/update-profile', upload.single('image'), updateUser);
router.post('/deactivate', deactivateUser);
router.get('/customers/:userId', getCustomerProfile);


router.get('/users', isAuthenticatedUser, authorizeRoles('Admin'), getAllUsers);
router.get('/users/:id', isAuthenticatedUser, authorizeRoles('Admin'), getSingleUser);
router.put('/users/:id/role', isAuthenticatedUser, authorizeRoles('Admin'), updateUserRole);
router.put('/users/:id/status', isAuthenticatedUser, authorizeRoles('Admin'), updateUserStatus);
router.post('/create-admin', isAuthenticatedUser, authorizeRoles('Admin'), createAdmin);
module.exports = router;
