const db = require('../config/database');

const getAllItems = (req, res) => {
    const categoryId = req.query.category;

    let sql = `
        SELECT i.*, s.*, c.description AS category 
        FROM item i
        INNER JOIN stock s ON i.item_id = s.item_id
        INNER JOIN category c ON i.category_id = c.category_id
        WHERE i.deleted_at IS NULL
    `;
    const params = [];

    // Filter by category if provided and not 'all'
    if (categoryId && categoryId !== 'all') {
        sql += ' AND i.category_id = ?';
        params.push(categoryId);
    }

    sql += ' GROUP BY i.item_id';

    const imagesSql = `
        SELECT item_id, image_path 
        FROM item_images 
        WHERE deleted_at IS NULL
    `;

    const reviewsSql = `
        SELECT r.*, ri.image_path AS review_image
        FROM reviews r
        LEFT JOIN review_images ri ON r.review_id = ri.review_id AND ri.deleted_at IS NULL
        WHERE r.deleted_at IS NULL
    `;

    try {
        db.query(sql, params, (err, items) => {
            if (err) {
                console.log(err);
                return res.status(500).json({ error: 'Database error fetching items' });
            }

            db.query(imagesSql, (err, images) => {
                if (err) {
                    console.log(err);
                    return res.status(500).json({ error: 'Database error fetching images' });
                }

                db.query(reviewsSql, (err, reviewsData) => {
                    if (err) {
                        console.log(err);
                        return res.status(500).json({ error: 'Database error fetching reviews' });
                    }

                    // Organize images by item_id
                    const imagesByItem = images.reduce((acc, image) => {
                        if (!acc[image.item_id]) {
                            acc[image.item_id] = [];
                        }
                        acc[image.item_id].push(image.image_path);
                        return acc;
                    }, {});

                    // Organize reviews by item_id
                    const reviewsByItem = reviewsData.reduce((acc, review) => {
                        if (!acc[review.item_id]) {
                            acc[review.item_id] = [];
                        }
                        
                        // Structure the review data
                        const reviewObj = {
                            review_id: review.review_id,
                            customer_id: review.customer_id,
                            orderinfo_id: review.orderinfo_id,
                            rating: review.rating,
                            review_text: review.review_text,
                            created_at: review.created_at,
                            images: []
                        };

                        // Add review image if exists
                        if (review.review_image) {
                            reviewObj.images.push(review.review_image);
                        }

                        // Check if this review already exists in the array
                        const existingReview = acc[review.item_id].find(r => r.review_id === review.review_id);
                        if (existingReview) {
                            // If review exists and has a new image, add it
                            if (review.review_image) {
                                existingReview.images.push(review.review_image);
                            }
                        } else {
                            acc[review.item_id].push(reviewObj);
                        }

                        return acc;
                    }, {});

                    // Calculate average rating for each item
                    const itemRatings = {};
                    Object.keys(reviewsByItem).forEach(itemId => {
                        const reviews = reviewsByItem[itemId];
                        if (reviews.length > 0) {
                            const total = reviews.reduce((sum, review) => sum + review.rating, 0);
                            itemRatings[itemId] = {
                                average_rating: (total / reviews.length).toFixed(1),
                                review_count: reviews.length
                            };
                        }
                    });

                    const itemsWithData = items.map(item => ({
                        ...item,
                        images: imagesByItem[item.item_id] || [],
                        image: imagesByItem[item.item_id]?.[0] || null,
                        reviews: reviewsByItem[item.item_id] || [],
                        average_rating: itemRatings[item.item_id]?.average_rating || '0.0',
                        review_count: itemRatings[item.item_id]?.review_count || 0
                    }));

                    return res.status(200).json({ rows: itemsWithData });
                });
            });
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ error: 'Server error' });
    }
};

// // Get items by category (public) 
// const getItemsByCategory = (req, res) => {
//     const categoryId = req.params.categoryId;

//     const sql = `
//         SELECT 
//             i.item_id, 
//             i.item_name, 
//             i.sell_price
//         FROM item i
//         WHERE i.deleted_at IS NULL 
//             AND i.category_id = ? 
//             AND i.category_id IN (
//                 SELECT category_id FROM category WHERE deleted_at IS NULL
//             )
//         GROUP BY i.item_id
//     `;

//     const imagesSql = `
//         SELECT item_id, image_path 
//         FROM item_images 
//         WHERE deleted_at IS NULL
//     `;

//     db.query(sql, [categoryId], (err, results) => {
//         if (err) {
//             console.error('❌ SQL Error:', err.message);
//             return res.status(500).json({ status: 'error', message: 'Internal Server Error' });
//         }

//         // Get all images
//         db.query(imagesSql, (err, images) => {
//             if (err) {
//                 console.error('❌ Images SQL Error:', err.message);
//                 return res.status(500).json({ status: 'error', message: 'Internal Server Error' });
//             }

//             // Group images by item_id
//             const imagesByItem = images.reduce((acc, image) => {
//                 if (!acc[image.item_id]) {
//                     acc[image.item_id] = [];
//                 }
//                 acc[image.item_id].push(image.image_path);
//                 return acc;
//             }, {});

//             const formatted = results.map(row => {
//                 return {
//                     item_id: row.item_id,
//                     item_name: row.item_name,
//                     sell_price: row.sell_price,
//                     images: imagesByItem[row.item_id] || []
//                 };
//             });

//             res.json({ status: 'success', data: formatted });
//         });
//     });
// };

// --------------------
// ADMIN FUNCTIONS
// --------------------

// Get all items with stock and category 
const getAllItemsWithStock = (req, res) => {
    const sql = `
        SELECT 
            i.item_id,
            i.item_name,
            i.description,
            i.cost_price,
            i.sell_price,
            i.category_id,
            i.created_at,
            i.updated_at,
            s.quantity,
            c.description AS category_name
        FROM item i
        INNER JOIN stock s ON i.item_id = s.item_id
        LEFT JOIN category c ON i.category_id = c.category_id
        WHERE i.deleted_at IS NULL AND (c.deleted_at IS NULL OR c.category_id IS NULL)
        GROUP BY i.item_id
    `;

    const imagesSql = `
        SELECT item_id, image_path 
        FROM item_images 
        WHERE deleted_at IS NULL
    `;

    db.query(sql, (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error', details: err });

        // Get all images
        db.query(imagesSql, (err, images) => {
            if (err) return res.status(500).json({ error: 'Database error fetching images', details: err });

            // Group images by item_id
            const imagesByItem = images.reduce((acc, image) => {
                if (!acc[image.item_id]) {
                    acc[image.item_id] = [];
                }
                acc[image.item_id].push(image.image_path);
                return acc;
            }, {});

            const formatted = rows.map(row => {
                const itemImages = imagesByItem[row.item_id] || [];
                return {
                    ...row,
                    image: itemImages[0] || null, // First image for backward compatibility
                    all_images: itemImages
                };
            });

            return res.status(200).json({ data: formatted });
        });
    });
};

// Get single item 
const getSingleItem = (req, res) => {
    const sql = `
        SELECT i.*, s.quantity
        FROM item i
        INNER JOIN stock s ON i.item_id = s.item_id
        WHERE i.item_id = ?
        GROUP BY i.item_id
    `;

    const imagesSql = `
        SELECT item_id, image_path 
        FROM item_images 
        WHERE deleted_at IS NULL AND item_id = ?
    `;

    db.query(sql, [req.params.id], (err, result) => {
        if (err) return res.status(500).json({ error: 'Database error', details: err });

        if (result.length === 0) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const item = result[0];

        // Get images for this item
        db.query(imagesSql, [req.params.id], (err, images) => {
            if (err) return res.status(500).json({ error: 'Database error fetching images', details: err });

            const itemImages = images.map(img => img.image_path);
            item.all_images = itemImages;
            item.image = itemImages[0] || null; // First image for backward compatibility

            return res.status(200).json({ success: true, result: [item] });
        });
    });
};

// Create item 
const createItem = (req, res) => {
    const { item_name, description, cost_price, sell_price, quantity, category_id } = req.body;
    const imageFiles = req.files || [];
    
    if (!item_name || !description || !cost_price || !sell_price || !quantity || !category_id) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const itemSql = `
        INSERT INTO item (item_name, description, cost_price, sell_price, category_id)
        VALUES (?, ?, ?, ?, ?)
    `;
    const itemValues = [item_name, description, cost_price, sell_price, category_id];

    db.execute(itemSql, itemValues, (err, result) => {
        if (err) return res.status(500).json({ error: 'Error inserting item', details: err });

        const itemId = result.insertId;

        const stockSql = `INSERT INTO stock (item_id, quantity) VALUES (?, ?)`;
        db.execute(stockSql, [itemId, quantity], (err2) => {
            if (err2) return res.status(500).json({ error: 'Error inserting stock', details: err2 });

            // Insert all images into item_images table
            if (imageFiles.length > 0) {
                const imgSql = `INSERT INTO item_images (item_id, image_path) VALUES ?`;
                const imgValues = imageFiles.map(file => [itemId, file.filename]);
                db.query(imgSql, [imgValues], (err3) => {      
                    if (err3) return res.status(500).json({ error: 'Error saving image path', details: err3 });
                    return res.status(201).json({ success: true, message: 'Item created with images', itemId });
                });
            } else {
                return res.status(201).json({ success: true, message: 'Item created', itemId });
            }
        });
    });
};

// Update item
const updateItem = (req, res) => {
    const itemId = req.params.id;
    const { item_name, description, cost_price, sell_price, quantity, category_id } = req.body;
    const imageFiles = req.files || [];

    const itemSql = `
        UPDATE item
        SET item_name = ?, description = ?, cost_price = ?, sell_price = ?, category_id = ?
        WHERE item_id = ?
    `;
    const itemValues = [item_name, description, cost_price, sell_price, category_id, itemId];

    db.execute(itemSql, itemValues, (err) => {
        if (err) return res.status(500).json({ error: 'Error updating item', details: err });

        const stockSql = `UPDATE stock SET quantity = ? WHERE item_id = ?`;
        db.execute(stockSql, [quantity, itemId], (err2) => {
            if (err2) return res.status(500).json({ error: 'Error updating stock', details: err2 });

            if (imageFiles.length > 0) {
                // Delete old images from item_images table
                const deleteSql = `DELETE FROM item_images WHERE item_id = ?`;
                db.query(deleteSql, [itemId], (delErr) => {
                    if (delErr) return res.status(500).json({ error: 'Error deleting old images', details: delErr });

                    // Insert new images
                    const imgSql = `INSERT INTO item_images (item_id, image_path) VALUES ?`;
                    const imgValues = imageFiles.map(file => [itemId, file.filename]);
                    db.query(imgSql, [imgValues], (err3) => {
                        if (err3) return res.status(500).json({ error: 'Error saving images', details: err3 });
                        return res.status(200).json({ success: true, message: 'Item updated with new images' });
                    });
                });
            } else {
                return res.status(200).json({ success: true, message: 'Item updated' });
            }
        });
    });
};

// Soft delete item
const softDeleteItem = (req, res) => {
    const itemId = req.params.id;
    const sql = `UPDATE item SET deleted_at = NOW() WHERE item_id = ?`;

    db.execute(sql, [itemId], (err) => {
        if (err) return res.status(500).json({ error: 'Error soft deleting item', details: err });
        return res.status(200).json({ success: true, message: 'Item soft deleted' });
    });
};

// Restore item
const restoreItem = (req, res) => {
    const itemId = req.params.id;
    const sql = `UPDATE item SET deleted_at = NULL WHERE item_id = ?`;

    db.execute(sql, [itemId], (err) => {
        if (err) return res.status(500).json({ error: 'Error restoring item', details: err });
        return res.status(200).json({ success: true, message: 'Item restored' });
    });
};

// Get all items including deleted
const getAllItemsIncludingDeleted = (req, res) => {
    const sql = `
        SELECT 
            i.*, s.quantity, 
            c.description AS category_name
        FROM item i
        LEFT JOIN stock s ON i.item_id = s.item_id
        LEFT JOIN category c ON i.category_id = c.category_id
        GROUP BY i.item_id
    `;

    const imagesSql = `
        SELECT item_id, image_path 
        FROM item_images 
        WHERE deleted_at IS NULL
    `;

    db.query(sql, (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error', details: err });

        // Get all images
        db.query(imagesSql, (err, images) => {
            if (err) return res.status(500).json({ error: 'Database error fetching images', details: err });

            // Group images by item_id
            const imagesByItem = images.reduce((acc, image) => {
                if (!acc[image.item_id]) {
                    acc[image.item_id] = [];
                }
                acc[image.item_id].push(image.image_path);
                return acc;
            }, {});

            const formatted = rows.map(row => {
                const itemImages = imagesByItem[row.item_id] || [];
                return {
                    ...row,
                    image: itemImages[0] || null, 
                    all_images: itemImages
                };
            });

            return res.status(200).json({ data: formatted });
        });
    });
};

// Search items by name 
const searchItems = (req, res) => {
    const { term } = req.params;
    const sql = `
        SELECT 
            i.item_id, 
            i.item_name, 
            i.sell_price
        FROM item i
        WHERE i.item_name LIKE ? AND i.deleted_at IS NULL
        GROUP BY i.item_id
    `;

    const imagesSql = `
        SELECT item_id, image_path 
        FROM item_images 
        WHERE deleted_at IS NULL
    `;

    const searchTerm = `%${term}%`;

    db.execute(sql, [searchTerm], (err, results) => {
        if (err) {
            console.error("❌ Search SQL Error:", err.message);
            return res.status(500).json({ status: 'error', message: err.message });
        }

        // Get all images
        db.query(imagesSql, (err, images) => {
            if (err) {
                console.error("❌ Images SQL Error:", err.message);
                return res.status(500).json({ status: 'error', message: err.message });
            }

            // Group images by item_id
            const imagesByItem = images.reduce((acc, image) => {
                if (!acc[image.item_id]) {
                    acc[image.item_id] = [];
                }
                acc[image.item_id].push(image.image_path);
                return acc;
            }, {});

            const formatted = results.map(row => {
                return {
                    item_id: row.item_id,
                    item_name: row.item_name,
                    sell_price: row.sell_price,
                    images: imagesByItem[row.item_id] || []
                };
            });

            return res.status(200).json({ status: 'success', data: formatted });
        });
    });
};

// --------------------
// EXPORTS
// --------------------
module.exports = {
    getAllItems,
    // getItemsByCategory,
    getAllItemsWithStock,
    getSingleItem,
    createItem,
    updateItem,
    deleteItem: softDeleteItem, 
    restoreItem,
    getAllItemsIncludingDeleted,
    searchItems              
};