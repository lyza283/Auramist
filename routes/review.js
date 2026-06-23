const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/review');
const upload = require('../middlewares/upload');
const { isAuthenticatedUser, authorizeRoles } = require('../middlewares/auth');

// Public routes
router.get('/', reviewController.getAllReviews);
router.get('/customer/:customerId', (req, res) => {
  const includeDeleted = req.query.include_deleted === 'true';
  reviewController.getReviewsByCustomer(req, res, includeDeleted);
});
router.get('/:id/images', reviewController.getReviewImages);


// Authenticated user routes
router.post('/create', 
  isAuthenticatedUser,
  upload.array('images', 5), 
  reviewController.createReview
);

router.put('/edit/:id', 
  isAuthenticatedUser,
  upload.array('images', 5), 
  reviewController.updateReview
); 

router.put('/delete/:id', 
  isAuthenticatedUser,
  reviewController.softDeleteReview
); 

router.patch('/restore/:id', 
  isAuthenticatedUser,
  reviewController.restoreReview
); 

// Admin-only routes
router.get('/admin', 
  isAuthenticatedUser, 
  authorizeRoles('Admin'), 
  reviewController.getAllDeletedReviews
);

module.exports = router;