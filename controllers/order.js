const db = require('../config/database'); 
const sendEmail = require('../utils/sendEmail');

const getShippingOptions = (req, res) => {
  const sql = `SELECT shipping_id, region, rate FROM shipping`;

  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching shipping options:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    res.json({ success: true, data: results });
  });
};

const createOrder = (req, res) => {
  const { customer_id, shipping_id, status, items } = req.body;

  // Validate required fields
  if (!customer_id || !shipping_id || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Missing or invalid order data' });
  }

  const date_placed = new Date().toISOString().slice(0, 19).replace('T', ' ');

  db.beginTransaction(err => {
    if (err) {
      console.error('Transaction error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    // Optimized stock check with single query
    const itemIds = items.map(item => item.item_id);
    const checkStockSql = 'SELECT item_id, quantity FROM stock WHERE item_id IN (?)';
    
    db.query(checkStockSql, [itemIds], (err, stockResults) => {
      if (err) {
        return db.rollback(() => {
          console.error('Stock check error:', err);
          res.status(500).json({ success: false, message: 'Database error' });
        });
      }

      // Create stock lookup map
      const stockMap = {};
      stockResults.forEach(stock => {
        stockMap[stock.item_id] = stock.quantity;
      });

      // Validate stock availability
      for (const item of items) {
        const availableStock = stockMap[item.item_id];
        if (availableStock === undefined) {
          return db.rollback(() => {
            res.status(400).json({ 
              success: false, 
              message: `Item with ID ${item.item_id} not found in stock` 
            });
          });
        }
        if (availableStock < item.quantity) {
          return db.rollback(() => {
            res.status(400).json({ 
              success: false, 
              message: `Insufficient stock for item ${item.item_id}. Available: ${availableStock}, Requested: ${item.quantity}` 
            });
          });
        }
      }

      // Create order
      const orderInfoSql = `
        INSERT INTO orderinfo (customer_id, date_placed, shipping_id, status)
        VALUES (?, NOW(), ?, ?)
      `;

      db.query(orderInfoSql, [customer_id, shipping_id, status || 'Pending'], (err, result) => {
        if (err) {
          return db.rollback(() => {
            console.error('Insert orderinfo error:', err);
            res.status(500).json({ success: false, message: 'Failed to create order' });
          });
        }

        const orderinfo_id = result.insertId;

        // Insert order lines
        const orderlines = items.map(item => [orderinfo_id, item.item_id, item.quantity]);
        const orderlineSql = 'INSERT INTO orderline (orderinfo_id, item_id, quantity) VALUES ?';

        db.query(orderlineSql, [orderlines], (err) => {
          if (err) {
            return db.rollback(() => {
              console.error('Insert orderline error:', err);
              res.status(500).json({ success: false, message: 'Failed to add order items' });
            });
          }

          // Optimized stock update with single query using CASE
          const stockUpdateSql = `
            UPDATE stock 
            SET quantity = CASE item_id 
            ${items.map(item => `WHEN ${item.item_id} THEN quantity - ${item.quantity}`).join(' ')}
            END
            WHERE item_id IN (${items.map(item => item.item_id).join(',')})
          `;

          db.query(stockUpdateSql, (err, result) => {
            if (err) {
              return db.rollback(() => {
                console.error('Stock update error:', err);
                res.status(500).json({ success: false, message: 'Failed to update stock quantities' });
              });
            }

            // Commit transaction
            db.commit(err => {
              if (err) {
                return db.rollback(() => {
                  console.error('Commit error:', err);
                  res.status(500).json({ success: false, message: 'Failed to finalize order' });
                });
              }

              // Send response immediately
              res.json({ 
                success: true, 
                message: 'Order created successfully', 
                orderinfo_id 
              });

              // Send email asynchronously (non-blocking)
              process.nextTick(() => {
                sendOrderConfirmationEmailAsync(orderinfo_id, customer_id, shipping_id, date_placed);
              });
            });
          });
        });
      });
    });
  });
};

// Async email function that doesn't block responses
const sendOrderConfirmationEmailAsync = async (orderinfo_id, customer_id, shipping_id, date_placed) => {
  try {
    // Fetch customer and shipping info
    const customerDetailsSql = `
      SELECT u.email, CONCAT(c.fname, ' ', c.lname) AS fullName, s.region, s.rate
      FROM customer c
      JOIN users u ON u.id = c.user_id
      JOIN shipping s ON s.shipping_id = ?
      WHERE c.customer_id = ?
    `;

    const userResult = await queryAsync(customerDetailsSql, [shipping_id, customer_id]);
    if (!userResult.length) {
      console.error('Customer info not found for order:', orderinfo_id);
      return;
    }

    const { email, fullName, region, rate } = userResult[0];

    // Fetch item details
    const itemDetailsSql = `
      SELECT i.item_name, i.sell_price AS price, ol.quantity
      FROM orderline ol
      JOIN item i ON ol.item_id = i.item_id
      WHERE ol.orderinfo_id = ?
    `;

    const itemRows = await queryAsync(itemDetailsSql, [orderinfo_id]);

    const itemsHtml = itemRows.map(item => `
      <tr>
        <td>${item.item_name}</td>
        <td>${item.quantity}</td>
        <td>₱${parseFloat(item.price).toFixed(2)}</td>
        <td>₱${(parseFloat(item.price) * item.quantity).toFixed(2)}</td>
      </tr>
    `).join('');

    const subtotal = itemRows.reduce((sum, i) => sum + parseFloat(i.price) * i.quantity, 0);
    const total = (subtotal + parseFloat(rate)).toFixed(2);

    const message = `
      <h3>Hi ${fullName || 'Customer'},</h3>
      <p>Thank you for placing your order with ROMEROS KINGDOM!</p>
      <p><strong>Order ID:</strong> ${orderinfo_id}</p>
      <p><strong>Date Placed:</strong> ${new Date(date_placed).toLocaleDateString()}</p>

      <h4>Order Summary</h4>
      <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">
        <thead>
          <tr><th>Item</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p><strong>Shipping:</strong> ${region} - ₱${parseFloat(rate).toFixed(2)}</p>
      <p><strong>Total:</strong> ₱${total}</p>

      <br><p>We will notify you once your order status is updated.<br></p>
    `;

    await sendEmailAsync({
      email,
      subject: `ROMEROS KINGDOM Order #${orderinfo_id} Confirmation`,
      message,
      attachPdf: true,
      pdfFilename: `Order_${orderinfo_id}_Receipt.pdf`
    });

    console.log(`Order confirmation email sent successfully for order ${orderinfo_id}`);
  } catch (error) {
    console.error(`Failed to send order confirmation email for order ${orderinfo_id}:`, error);
  }
};

// Helper function to promisify database queries
const queryAsync = (sql, params) => {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

// Helper function to promisify email sending
const sendEmailAsync = (emailOptions) => {
  return new Promise((resolve, reject) => {
    sendEmail(emailOptions, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const getOrdersByCustomer = (req, res) => {
  const customerId = req.params.customerId;

  const sql = `
    SELECT 
      o.orderinfo_id,
      o.date_placed,
      o.status,
      s.region,
      s.rate
    FROM orderinfo o
    JOIN shipping s ON o.shipping_id = s.shipping_id
    WHERE o.customer_id = ? AND o.deleted_at IS NULL
    ORDER BY o.date_placed DESC
  `;

  db.query(sql, [customerId], (err, orders) => {
    if (err) {
      console.error("Error fetching orders:", err);
      return res.status(500).json({ success: false, message: "Error fetching orders" });
    }

    if (!orders.length) {
      return res.json({ success: true, data: [] });
    }

    const orderIds = orders.map(o => o.orderinfo_id);
    const placeholders = orderIds.map(() => '?').join(',');

    const itemSql = `
      SELECT 
        ol.orderinfo_id,
        ol.item_id,  
        i.item_name,
        i.sell_price AS price,
        ol.quantity
      FROM orderline ol
      JOIN item i ON i.item_id = ol.item_id
      WHERE ol.orderinfo_id IN (${placeholders}) AND ol.deleted_at IS NULL
    `;

    db.query(itemSql, orderIds, (err, orderItems) => {
      if (err) {
        console.error("Error fetching order items:", err);
        return res.status(500).json({ success: false, message: "Error fetching items" });
      }

      const grouped = {};
      orderItems.forEach(item => {
        if (!grouped[item.orderinfo_id]) grouped[item.orderinfo_id] = [];
        grouped[item.orderinfo_id].push({
          item_id: item.item_id, 
          item_name: item.item_name,
          quantity: item.quantity,
          price: item.price
        });
      });

      const final = orders.map(order => ({
        ...order,
        items: grouped[order.orderinfo_id] || []
      }));

      res.json({ success: true, data: final });
    });
  });
};

const getAllOrders = (req, res) => {
  const sql = `
    SELECT 
      o.orderinfo_id,
      o.customer_id,
      o.date_placed,
      o.date_shipped,
      o.date_delivered,
      o.shipping_id,
      o.status,
      o.deleted_at,
      CONCAT(c.fname, ' ', c.lname) AS customer_name,
      s.region AS shipping_method,
      COUNT(ol.item_id) AS total_items
    FROM orderinfo o
    JOIN customer c ON o.customer_id = c.customer_id
    LEFT JOIN shipping s ON o.shipping_id = s.shipping_id
    LEFT JOIN orderline ol ON o.orderinfo_id = ol.orderinfo_id AND ol.deleted_at IS NULL
    GROUP BY o.orderinfo_id, o.customer_id, o.date_placed, o.date_shipped, o.date_delivered, o.shipping_id, o.status, o.deleted_at, c.fname, c.lname, s.region
    ORDER BY o.date_placed DESC
  `;

  db.query(sql, (err, orders) => {
    if (err) {
      console.error('Database error fetching orders:', err);
      return res.status(500).json({ 
        success: false, 
        message: 'Database error fetching orders',
        error: err.message 
      });
    }

    const formattedOrders = orders.map(order => ({
      ...order,
      date_placed: order.date_placed ? new Date(order.date_placed).toLocaleString('en-US', { timeZone: 'Asia/Manila' }) : null,
      date_shipped: order.date_shipped ? new Date(order.date_shipped).toLocaleString('en-US', { timeZone: 'Asia/Manila' }) : null,
      date_delivered: order.date_delivered ? new Date(order.date_delivered).toLocaleString('en-US', { timeZone: 'Asia/Manila' }) : null,
    }));

    return res.status(200).json({
      success: true,
      data: formattedOrders
    });
  });
};

const getOrderById = (req, res) => {
  const orderId = req.params.orderId;

  const orderSql = `
    SELECT 
      o.orderinfo_id,
      o.customer_id,
      o.date_placed,
      o.date_shipped,
      o.date_delivered,
      o.shipping_id,
      o.status,
      o.deleted_at,
      CONCAT(c.fname, ' ', c.lname) AS customer_name,
      s.region AS shipping_method,
      s.rate AS shipping_rate
    FROM orderinfo o
    JOIN customer c ON o.customer_id = c.customer_id
    LEFT JOIN shipping s ON o.shipping_id = s.shipping_id
    WHERE o.orderinfo_id = ?
  `;

  db.query(orderSql, [orderId], (err, orderResults) => {
    if (err) {
      console.error('Error fetching order:', err);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch order details',
        error: err.message 
      });
    }

    if (orderResults.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    const order = orderResults[0];

    const itemsSql = `
      SELECT 
        ol.item_id,
        ol.quantity,
        i.item_name,
        i.sell_price AS unit_price,
        (ol.quantity * i.sell_price) AS total_price
      FROM orderline ol
      JOIN item i ON ol.item_id = i.item_id
      WHERE ol.orderinfo_id = ? AND ol.deleted_at IS NULL
    `;

    db.query(itemsSql, [orderId], (err, itemResults) => {
      if (err) {
        console.error('Error fetching order items:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to fetch order items',
          error: err.message 
        });
      }

      const subtotal = itemResults.reduce((sum, item) => sum + parseFloat(item.total_price), 0);
      const total = subtotal + parseFloat(order.shipping_rate || 0);

      const result = {
        ...order,
        items: itemResults,
        subtotal: subtotal,
        total: total,
        total_items: itemResults.length
      };

      res.json({ success: true, data: result });
    });
  });
};

const updateOrderStatus = (req, res) => {
  const orderId = req.params.orderId;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({
      success: false,
      message: 'Status is required',
    });
  }

  const validStatuses = ['Pending', 'Shipped', 'Delivered', 'Cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid status value',
    });
  }

  let updateSql = 'UPDATE orderinfo SET status = ?';
  const params = [status];

  if (status === 'Shipped') {
    updateSql += ', date_shipped = NOW()';
  } else if (status === 'Delivered') {
    updateSql += ', date_delivered = NOW()';
  }

  updateSql += ' WHERE orderinfo_id = ?';
  params.push(orderId);

  db.query(updateSql, params, (err, result) => {
    if (err) {
      console.error('Error updating order status:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to update order status',
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    // Send response immediately
    res.json({
      success: true,
      message: 'Order status updated successfully',
    });

    // Send email asynchronously (non-blocking)
    process.nextTick(() => {
      sendOrderStatusUpdateEmailAsync(orderId, status);
    });
  });
};

// Async email function for status updates
const sendOrderStatusUpdateEmailAsync = async (orderId, status) => {
  try {
    // Fetch customer, shipping, and order info
    const customerDetailsSql = `
      SELECT 
        u.email, CONCAT(c.fname, ' ', c.lname) AS fullName, 
        s.region, s.rate, o.date_placed, o.date_shipped, o.date_delivered
      FROM orderinfo o
      JOIN customer c ON o.customer_id = c.customer_id
      JOIN users u ON u.id = c.user_id
      JOIN shipping s ON o.shipping_id = s.shipping_id
      WHERE o.orderinfo_id = ?
    `;

    const userResult = await queryAsync(customerDetailsSql, [orderId]);
    if (!userResult.length) {
      console.error('Customer info not found for order:', orderId);
      return;
    }

    const {
      email,
      fullName,
      region,
      rate,
      date_placed,
      date_shipped,
      date_delivered
    } = userResult[0];

    // Fetch item details
    const itemDetailsSql = `
      SELECT i.item_name, i.sell_price AS price, ol.quantity
      FROM orderline ol
      JOIN item i ON ol.item_id = i.item_id
      WHERE ol.orderinfo_id = ? AND ol.deleted_at IS NULL
    `;

    const itemRows = await queryAsync(itemDetailsSql, [orderId]);

    const itemsHtml = itemRows.map(item => `
      <tr>
        <td>${item.item_name}</td>
        <td>${item.quantity}</td>
        <td>₱${parseFloat(item.price).toFixed(2)}</td>
        <td>₱${(parseFloat(item.price) * item.quantity).toFixed(2)}</td>
      </tr>
    `).join('');

    const subtotal = itemRows.reduce((sum, i) => sum + parseFloat(i.price) * i.quantity, 0);
    const total = (subtotal + parseFloat(rate)).toFixed(2);

    const statusMessages = {
      Pending: 'Your order is now marked as <strong>Pending</strong>. We\'ll prepare it shortly!',
      Shipped: 'Your order has been <strong>shipped</strong> and is on its way.',
      Delivered: 'Your order has been <strong>delivered</strong>. We hope you enjoy your purchase!',
      Cancelled: 'We\'re sorry. Your order has been <strong>cancelled</strong>. Please contact us if this was a mistake.',
    };

    const formatDateTime = (date) =>
      date ? new Date(date).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '';

    const message = `
      <h3>Hi ${fullName || 'Customer'},</h3>
      <p>${statusMessages[status]}</p>
      <p><strong>Order ID:</strong> ${orderId}</p>
      <p><strong>Date Placed:</strong> ${formatDateTime(date_placed)}</p>
      ${date_shipped ? `<p><strong>Date Shipped:</strong> ${formatDateTime(date_shipped)}</p>` : ''}
      ${date_delivered ? `<p><strong>Date Delivered:</strong> ${formatDateTime(date_delivered)}</p>` : ''}

      <h4>Order Summary</h4>
      <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">
        <thead>
          <tr><th>Item</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p><strong>Shipping:</strong> ${region} - ₱${parseFloat(rate).toFixed(2)}</p>
      <p><strong>Total:</strong> ₱${total}</p>

      <br><p>Thank you for shopping at ROMEROS KINGDOM!</p>
    `;

    await sendEmailAsync({
      email,
      subject: `ROMEROS KINGDOM Order #${orderId} Status Update: ${status}`,
      message,
      attachPdf: true
    });

    console.log(`Order status update email sent successfully for order ${orderId}`);
  } catch (error) {
    console.error(`Failed to send order status update email for order ${orderId}:`, error);
  }
};

const softDeleteOrder = (req, res) => {
  const orderId = req.params.orderId;
  
  const orderSql = `UPDATE orderinfo SET deleted_at = NOW() WHERE orderinfo_id = ?`;
  const lineSql = `UPDATE orderline SET deleted_at = NOW() WHERE orderinfo_id = ?`;

  db.beginTransaction(err => {
    if (err) {
      console.error('Transaction error:', err);
      return res.status(500).json({ success: false, message: 'Transaction failed', error: err.message });
    }

    db.query(orderSql, [orderId], (err, result) => {
      if (err) {
        return db.rollback(() => {
          console.error('Error soft deleting orderinfo:', err);
          res.status(500).json({ success: false, message: 'Error soft deleting order', error: err.message });
        });
      }

      if (result.affectedRows === 0) {
        return db.rollback(() => {
          res.status(404).json({ success: false, message: 'Order not found' });
        });
      }

      db.query(lineSql, [orderId], (err) => {
        if (err) {
          return db.rollback(() => {
            console.error('Error soft deleting orderlines:', err);
            res.status(500).json({ success: false, message: 'Error soft deleting order lines', error: err.message });
          });
        }

        db.commit(err => {
          if (err) {
            return db.rollback(() => {
              console.error('Commit failed:', err);
              res.status(500).json({ success: false, message: 'Commit failed', error: err.message });
            });
          }
          res.status(200).json({ success: true, message: 'Order and order lines soft deleted' });
        });
      });
    });
  });
};

const restoreOrder = (req, res) => {
  const orderId = req.params.orderId;

  const orderSql = `UPDATE orderinfo SET deleted_at = NULL WHERE orderinfo_id = ?`;
  const lineSql = `UPDATE orderline SET deleted_at = NULL WHERE orderinfo_id = ?`;

  db.beginTransaction(err => {
    if (err) {
      console.error('Transaction error:', err);
      return res.status(500).json({ success: false, message: 'Transaction failed', error: err.message });
    }

    db.query(orderSql, [orderId], (err, result) => {
      if (err) {
        return db.rollback(() => {
          console.error('Error restoring orderinfo:', err);
          res.status(500).json({ success: false, message: 'Error restoring order', error: err.message });
        });
      }

      if (result.affectedRows === 0) {
        return db.rollback(() => {
          res.status(404).json({ success: false, message: 'Order not found' });
        });
      }

      db.query(lineSql, [orderId], (err) => {
        if (err) {
          return db.rollback(() => {
            console.error('Error restoring orderlines:', err);
            res.status(500).json({ success: false, message: 'Error restoring order lines', error: err.message });
          });
        }

        db.commit(err => {
          if (err) {
            return db.rollback(() => {
              console.error('Commit failed:', err);
              res.status(500).json({ success: false, message: 'Commit failed', error: err.message });
            });
          }
          res.status(200).json({ success: true, message: 'Order and order lines restored' });
        });
      });
    });
  });
};

module.exports = {
  createOrder,
  getOrdersByCustomer,
  getShippingOptions,
  getAllOrders,
  getOrderById,
  updateOrderStatus,
  softDeleteOrder,
  restoreOrder
};