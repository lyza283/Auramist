const db = require('../config/database');

// Helper function to handle database errors
const handleDbError = (res, err, operation) => {
    console.error(`Database error during ${operation}:`, err);
    return res.status(500).json({ 
        success: false,
        error: `Database error during ${operation}`,
        details: err.message 
    });
};

// Helper function to validate review data
const validateReviewData = (data) => {
    const { orderinfo_id, customer_id, item_id, rating } = data;
    const errors = [];
    
    if (!orderinfo_id) errors.push('orderinfo_id is required');
    if (!customer_id) errors.push('customer_id is required');
    if (!item_id) errors.push('item_id is required');
    if (!rating) errors.push('rating is required');
    if (rating && (rating < 1 || rating > 5)) errors.push('rating must be between 1 and 5');
    
    return errors.length ? errors : null;
};


const createReview = (req, res) => {
  const { orderinfo_id, item_id, rating, review_text } = req.body;
  const user_id = req.user.id; // From JWT auth middleware

  // Step 1: Get customer_id from user_id
  db.execute(
    'SELECT customer_id FROM customer WHERE user_id = ?',
    [user_id],
    (err, customerRows) => {
      if (err) {
        console.error('Database error during customer lookup:', err);
        return res.status(500).json({ error: 'Database error.' });
      }

      if (customerRows.length === 0) {
        return res.status(404).json({ error: 'Customer not found for this user.' });
      }

      const customer_id = customerRows[0].customer_id;

      // Step 2: Insert review
      db.execute(
        `INSERT INTO reviews 
         (orderinfo_id, customer_id, item_id, rating, review_text, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [orderinfo_id, customer_id, item_id, rating, review_text],
        (err, reviewResult) => {
          if (err) {
            console.error('Database error during review insert:', err);
            return res.status(500).json({ error: 'Failed to insert review.' });
          }

          const review_id = reviewResult.insertId;

          // Step 3: Insert uploaded images (if any)
          const imageFiles = req.files || [];
          if (imageFiles.length === 0) {
            return res.status(201).json({ message: 'Review created successfully.', review_id });
          }

          let completed = 0;
          for (const file of imageFiles) {
            // Get relative path like 'uploads/reviews/filename.jpg'
            const relativePath = file.path.replace(/^public[\\/]/, '').replace(/\\/g, '/'); // Normalize slashes

            db.execute(
              `INSERT INTO review_images (review_id, image_path, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
              [review_id, relativePath],
              (err) => {
                if (err) {
                  console.error('Error inserting review image:', err);
                }
                completed++;
                if (completed === imageFiles.length) {
                  res.status(201).json({ message: 'Review and images saved successfully.', review_id });
                }
              }
            );
          }
        }
      );
    }
  );
};



const getAllReviews = async (req, res) => {
    try {
        // Get all active reviews
        const [reviews] = await db.promise().query(`
            SELECT 
                r.*, 
                i.item_name,
                c.fname,
                c.lname,
                CONCAT(c.fname, ' ', c.lname) AS customer_name
            FROM reviews r
            INNER JOIN item i ON r.item_id = i.item_id
            INNER JOIN customer c ON r.customer_id = c.customer_id
            WHERE r.deleted_at IS NULL
            ORDER BY r.created_at DESC
        `);

        // Get all active review images
        const [images] = await db.promise().query(`
            SELECT review_id, image_path 
            FROM review_images 
            WHERE deleted_at IS NULL
        `);

        // Group images by review_id
        const imagesByReview = images.reduce((acc, image) => {
            if (!acc[image.review_id]) {
                acc[image.review_id] = [];
            }
            acc[image.review_id].push(image.image_path);
            return acc;
        }, {});

        // Combine reviews with their images
        const reviewsWithImages = reviews.map(review => ({
            ...review,
            images: imagesByReview[review.review_id] || [],
            image: imagesByReview[review.review_id]?.[0] || null
        }));

        return res.status(200).json({
            success: true,
            data: reviewsWithImages
        });

    } catch (err) {
        return handleDbError(res, err, 'fetching reviews');
    }
};

const getAllDeletedReviews = async (req, res) => {
    try {
        // Get all deleted reviews
        const [reviews] = await db.promise().query(`
            SELECT 
                r.*, 
                i.item_name,
                c.fname,
                c.lname,
                CONCAT(c.fname, ' ', c.lname) AS customer_name
            FROM reviews r
            INNER JOIN item i ON r.item_id = i.item_id
            INNER JOIN customer c ON r.customer_id = c.customer_id
            WHERE r.deleted_at IS NOT NULL
            ORDER BY r.deleted_at DESC
        `);

        // Get all active review images
        const [images] = await db.promise().query(`
            SELECT review_id, image_path 
            FROM review_images 
            WHERE deleted_at IS NULL
        `);

        // Group images by review_id
        const imagesByReview = images.reduce((acc, image) => {
            if (!acc[image.review_id]) {
                acc[image.review_id] = [];
            }
            acc[image.review_id].push(image.image_path);
            return acc;
        }, {});

        // Combine reviews with their images
        const reviewsWithImages = reviews.map(review => ({
            ...review,
            images: imagesByReview[review.review_id] || [],
            image: imagesByReview[review.review_id]?.[0] || null
        }));

        return res.status(200).json({
            success: true,
            data: reviewsWithImages
        });

    } catch (err) {
        return handleDbError(res, err, 'fetching deleted reviews');
    }
};

const getReviewsByCustomer = async (req, res) => {
    try {
        const customerId = req.params.customerId;
        const includeDeleted = req.query.include_deleted === 'true';

        // Base query
        let query = `
            SELECT 
                r.review_id,
                r.orderinfo_id,
                r.created_at,
                r.updated_at,
                r.deleted_at,
                r.item_id,
                r.rating,
                r.review_text,
                r.created_at,
                i.item_name,
                i.sell_price AS price
            FROM reviews r
            JOIN item i ON r.item_id = i.item_id
            WHERE r.customer_id = ?
        `;

        // Add condition for deleted reviews if not including them
        if (!includeDeleted) {
            query += ` AND r.deleted_at IS NULL`;
        }

        // Add sorting
        query += ` ORDER BY r.created_at DESC`;

        // Get customer's reviews
        const [reviews] = await db.promise().query(query, [customerId]);

        if (!reviews.length) {
            return res.status(200).json({
                success: true,
                data: []
            });
        }

        // Get review images in one query
        const reviewIds = reviews.map(r => r.review_id);
        let imageQuery = `
            SELECT review_id, image_path
            FROM review_images
            WHERE review_id IN (?)
        `;

        // Conditionally include deleted images
        if (!includeDeleted) {
            imageQuery += ` AND deleted_at IS NULL`;
        }

        const [reviewImages] = await db.promise().query(imageQuery, [reviewIds]);

        // Group images by review_id
        const imagesByReview = reviewImages.reduce((acc, image) => {
            if (!acc[image.review_id]) {
                acc[image.review_id] = [];
            }
            acc[image.review_id].push(image.image_path);
            return acc;
        }, {});

        // Combine reviews with their images
        const reviewsWithImages = reviews.map(review => ({
            ...review,
            images: imagesByReview[review.review_id] || [],
            image: imagesByReview[review.review_id]?.[0] || null
        }));

        return res.status(200).json({
            success: true,
            data: reviewsWithImages
        });

    } catch (err) {
        return handleDbError(res, err, 'fetching customer reviews');
    }
};

// Get images for a specific review
const getReviewImages = async (req, res) => {
    try {
        const reviewId = req.params.id;
        const [images] = await db.promise().query(
            `SELECT reviewimg_id, image_path, created_at FROM review_images WHERE review_id = ? AND deleted_at IS NULL`,
            [reviewId]
        );
        return res.status(200).json({
            success: true,
            data: images
        });
    } catch (err) {
        return handleDbError(res, err, 'fetching review images');
    }
};

module.exports = {
    // ...existing exports
    getReviewImages,
};

const updateReview = async (req, res) => {
    try {
        const reviewId = req.params.id;
        const { rating, review_text } = req.body;
        const imageFiles = req.files || [];

        // Validate rating if provided
        if (rating && (rating < 1 || rating > 5)) {
            return res.status(400).json({
                success: false,
                error: 'Rating must be between 1 and 5'
            });
        }

        await db.promise().beginTransaction();

        try {
            // Update review content
            await db.promise().execute(
                `UPDATE reviews 
                SET rating = ?, review_text = ?, updated_at = NOW() 
                WHERE review_id = ?`,
                [rating, review_text, reviewId]
            );

            // If new images were uploaded
            if (imageFiles.length > 0) {
                // Delete old images
                await db.promise().execute(
                    `DELETE FROM review_images WHERE review_id = ?`,
                    [reviewId]
                );

                // Prepare new image paths (strip "public/" prefix)
                const imageValues = imageFiles.map(file => {
                    const cleanPath = file.path.replace(/^public[\\/]/, '');
                    return [reviewId, cleanPath, new Date()];
                });

                // Insert new image records
               await db.promise().query(
  `INSERT INTO review_images (review_id, image_path, created_at) VALUES ?`,
  [imageFiles.map(file => [reviewId, `uploads/reviews/${file.filename}`, new Date()])]
);

            }

            await db.promise().commit();

            return res.status(200).json({
                success: true,
                message: 'Review updated successfully'
            });

        } catch (err) {
            await db.promise().rollback();
            return handleDbError(res, err, 'updating review');
        }

    } catch (err) {
        return handleDbError(res, err, 'updating review');
    }
};


const softDeleteReview = async (req, res) => {
    try {
        const reviewId = req.params.id;

        const [result] = await db.promise().execute(
            `UPDATE reviews SET deleted_at = NOW() WHERE review_id = ?`,
            [reviewId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Review not found'
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Review soft deleted successfully'
        });

    } catch (err) {
        return handleDbError(res, err, 'soft deleting review');
    }
};

const restoreReview = async (req, res) => {
    try {
        const reviewId = req.params.id;

        // Check if review exists and is deleted
        const [check] = await db.promise().execute(
            `SELECT review_id FROM reviews WHERE review_id = ? AND deleted_at IS NOT NULL`,
            [reviewId]
        );

        if (check.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Review not found or already restored'
            });
        }

        // Restore the review
        const [result] = await db.promise().execute(
            `UPDATE reviews SET deleted_at = NULL WHERE review_id = ?`,
            [reviewId]
        );

        return res.status(200).json({
            success: true,
            message: 'Review restored successfully'
        });

    } catch (err) {
        console.error('Error restoring review:', err);
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
};

module.exports = {
    createReview,
    getAllReviews,
    getAllDeletedReviews,
    getReviewsByCustomer,
    updateReview,
    softDeleteReview,
    restoreReview,
    getReviewImages
};