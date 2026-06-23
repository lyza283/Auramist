const connection = require('../config/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// ----------------- Register -----------------
const registerUser = async (req, res) => {
  const { name, password, email } = req.body;
  
  try {
    // First check if email exists
    const checkSql = 'SELECT id FROM users WHERE email = ?';
    connection.execute(checkSql, [email], async (checkErr, checkResults) => {
      if (checkErr) {
        console.error('Database check error:', checkErr);
        return res.status(500).json({ error: 'Database error' });
      }

      if (checkResults.length > 0) {
        return res.status(400).json({ error: 'Email already exists' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const userSql = 'INSERT INTO users (name, password, email) VALUES (?, ?, ?)';
      
      connection.execute(userSql, [name, hashedPassword, email], (insertErr, result) => {
        if (insertErr) {
          console.error('Database insert error:', insertErr);
          return res.status(500).json({ error: 'Failed to register user' });
        }

        return res.status(200).json({ 
          success: true, 
          userId: result.insertId 
        });
      });
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ----------------- Login -----------------
const loginUser = (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required',
      code: 'MISSING_CREDENTIALS'
    });
  }

  // Updated SQL query to include role
  const sql = `
    SELECT id, name, email, password, status, role 
    FROM users 
    WHERE email = ?
  `;

  connection.execute(sql, [email], async (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({
        success: false,
        message: 'Database error during login',
        code: 'DATABASE_ERROR'
      });
    }

    // No user found
    if (results.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    const user = results[0];

    // Check if account is deactivated
    if (user.status === 'Deactivated') {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact support.',
        code: 'ACCOUNT_DEACTIVATED',
      });
    }

    // Verify password
    try {
      const safePasswordHash = user.password.replace(/^\$2y\$/, '$2b$');
      const match = await bcrypt.compare(password, safePasswordHash);

      if (!match) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password',
          code: 'INVALID_CREDENTIALS'
        });
      }

      // Include role in JWT token
      const token = jwt.sign({
        id: user.id,
        email: user.email,
        role: user.role || 'User'  // Include role in token
      }, process.env.JWT_SECRET, {
        expiresIn: '24h'
      });

      const updateSql = 'UPDATE users SET token = ? WHERE id = ?';
      connection.execute(updateSql, [token, user.id], (updateErr) => {
        if (updateErr) {
          console.error('Token update error:', updateErr);
          return res.status(500).json({
            success: false,
            message: 'Error updating user session',
            code: 'TOKEN_UPDATE_FAILED'
          });
        }

        const userResponse = {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role || 'User'  
        };

        return res.status(200).json({
          success: true,
          message: 'Login successful',
          user: userResponse,
          token
        });
      });

    } catch (hashError) {
      console.error('Password hash error:', hashError);
      return res.status(500).json({
        success: false,
        message: 'Error verifying password',
        code: 'PASSWORD_VERIFICATION_FAILED'
      });
    }
  });
};

// ----------------- Create or Update Profile -----------------

// ----------------- Update User Profile -----------------
const updateUser = (req, res) => {
  const title = req.body.title;
  const fname = req.body.fname;
  const lname = req.body.lname;
  const addressline = req.body.addressline;
  const town = req.body.town;
  const phone = req.body.phone;
  const userId = req.body.userId;

  const image = req.file ? req.file.path.replace(/\\/g, "/").replace("public/", "") : null;

    // ✅ Add the log here
  console.log('Form data received:', {
    title, fname, lname, addressline, town, phone, userId, image
  });

  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  const checkSql = `SELECT customer_id FROM customer WHERE user_id = ?`;
  connection.query(checkSql, [userId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    if (results.length === 0) {
      // No customer row found, so INSERT
      const insertSql = `
        INSERT INTO customer (title, fname, lname, addressline, town, phone, user_id, image_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const insertValues = [title, fname, lname, addressline, town, phone, userId, image];

      connection.query(insertSql, insertValues, (insertErr) => {
        if (insertErr) return res.status(500).json({ error: insertErr.message });
        return res.json({ message: "Profile created successfully" });
      });

    } else {
      // Customer row found, so UPDATE
      const customerId = results[0].customer_id;
      const updateSql = `
  UPDATE customer SET 
    title = ?, 
    fname = ?, 
    lname = ?, 
    addressline = ?, 
    town = ?, 
    phone = ?${image ? ', image_path = ?' : ''}
  WHERE customer_id = ?
`;


      const updateValues = image
        ? [title, fname, lname, addressline, town, phone, image, customerId]
        : [title, fname, lname, addressline, town, phone, customerId];

      connection.query(updateSql, updateValues, (updateErr) => {
        if (updateErr) return res.status(500).json({ error: updateErr.message });
        return res.json({ message: "Profile updated successfully" });
      });
    }
  });
};

// ----------------- Create Admin -----------------
const createAdmin = async (req, res) => {
  const { name, password, email } = req.body;
  
  try {
    const checkSql = 'SELECT id FROM users WHERE email = ?';
    connection.execute(checkSql, [email], async (checkErr, checkResults) => {
      if (checkErr) {
        console.error('Database check error:', checkErr);
        return res.status(500).json({ error: 'Database error' });
      }

      if (checkResults.length > 0) {
        return res.status(400).json({ error: 'Email already exists' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const userSql = 'INSERT INTO users (name, password, email, role) VALUES (?, ?, ?, "Admin")';
      
      connection.execute(userSql, [name, hashedPassword, email], (insertErr, result) => {
        if (insertErr) {
          console.error('Database insert error:', insertErr);
          return res.status(500).json({ error: 'Failed to create admin user' });
        }

        return res.status(200).json({ 
          success: true, 
          userId: result.insertId 
        });
      });
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
// ----------------- Deactivate User -----------------
const deactivateUser = async (req, res) => {
  const { userId, password } = req.body;

  if (!userId || !password) {
    return res.status(400).json({
      success: false,
      error: 'User ID and password are required',
      code: 'MISSING_FIELDS'
    });
  }

  try {
    // Start transaction
    await connection.promise().beginTransaction();

    try {
      // 1. Get user data including password hash
      const [userRows] = await connection.promise().execute(
        `SELECT id, password, email, status 
         FROM users 
         WHERE id = ?`,
        [userId]
      );

      if (userRows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      const user = userRows[0];

      // Verify password (with hash conversion if needed)
      const passwordHash = user.password.replace(/^\$2y\$/, '$2b$');
      const passwordMatch = await bcrypt.compare(password, passwordHash);

      if (!passwordMatch) {
        return res.status(401).json({
          success: false,
          error: 'Incorrect password',
          code: 'INVALID_PASSWORD'
        });
      }

      // Deactivate user account 
      const [result] = await connection.promise().execute(
        `UPDATE users 
         SET status = 'Deactivated', 
             token = NULL, 
             updated_at = NOW() 
         WHERE id = ?`,
        [userId]
      );

      if (result.affectedRows === 0) {
        throw new Error('No rows affected - user not updated');
      }

      // Commit transaction
      await connection.promise().commit();

      return res.status(200).json({
        success: true,
        message: 'User deactivated successfully',
        userId,
        updated_at: new Date().toISOString()
      });

    } catch (transactionErr) {
      // Rollback on error
      await connection.promise().rollback();
      console.error('Transaction error:', transactionErr);
      throw transactionErr;
    }

  } catch (err) {
    console.error('Deactivation error:', err);
    return res.status(500).json({
      success: false,
      error: 'Server error during deactivation',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      code: 'SERVER_ERROR'
    });
  }
};

// ----------------- Get Customer Profile -----------------
const getCustomerProfile = (req, res) => {
  const userId = req.params.userId;
  const sql = 'SELECT * FROM customer WHERE user_id = ?';

  connection.execute(sql, [userId], (err, results) => {
    if (err) return res.status(500).json({ error: err });
    if (results.length === 0) return res.status(404).json({ message: 'No profile found' });

    return res.status(200).json({ success: true, data: results[0] });
  });
};

const updateUserRole = (req, res) => {
  const id = req.params.id;
  const { role } = req.body;

  if (!role) {
    return res.status(400).json({ error: 'Role is required' });
  }

  const sql = `
        UPDATE users
        SET role = ?, updated_at = NOW()
        WHERE id = ? AND deleted_at IS NULL
    `;
  const values = [role, id];

  try {
    connection.execute(sql, values, (err, result) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ error: 'Error updating user role', details: err });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.status(200).json({
        success: true,
        message: 'User role updated successfully'
      });
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Server error' });
  }
};

const updateUserStatus = (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: 'Status is required' });
  }

  const sql = `
        UPDATE users
        SET status = ?, updated_at = NOW()
        WHERE id = ? AND deleted_at IS NULL
    `;
  const values = [status, id];

  try {
    connection.execute(sql, values, (err, result) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ error: 'Error updating user status', details: err });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.status(200).json({
        success: true,
        message: 'User status updated successfully'
      });
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Server error' });
  }
};

const getAllUsers = (req, res) => {
  const sql = `
        SELECT u.*, c.addressline, c.town, c.phone
        FROM users u
        LEFT JOIN customer c ON u.id = c.user_id
        ORDER BY u.id DESC
    `;

  connection.execute(sql, (err, users) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({
        success: false,
        error: 'Database error fetching users',
        details: err.message
      });
    }

    return res.status(200).json({
      success: true,
      rows: users
    });
  });
};

const getSingleUser = (req, res) => {
  const id = req.params.id;

  // Validate ID
  if (!id || isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid user ID'
    });
  }

  const sql = `
        SELECT u.*, c.addressline, c.town, c.phone
        FROM users u
        LEFT JOIN customer c ON u.id = c.user_id
        WHERE u.id = ? AND u.deleted_at IS NULL
    `;

  const values = [parseInt(id)];

  connection.execute(sql, values, (err, result) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({
        success: false,
        error: 'Database error fetching user',
        details: err.message
      });
    }

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    console.log('User fetched successfully:', result[0]);
    return res.status(200).json({
      success: true,
      result: result[0]
    });
  });
};
// const deleteUser = (req, res) => {
//     const id = req.params.id;

//     const sql = `
//         UPDATE users
//         SET deleted_at = NOW()
//         WHERE id = ? AND deleted_at IS NULL
//     `;
//     const values = [id];

//     try {
//         connection.execute(sql, values, (err, result) => {
//             if (err) {
//                 console.log(err);
//                 return res.status(500).json({ error: 'Error deleting user', details: err });
//             }

//             if (result.affectedRows === 0) {
//                 return res.status(404).json({ error: 'User not found' });
//             }

//             return res.status(200).json({
//                 success: true,
//                 message: 'User deleted successfully'
//             });
//         });
//     } catch (error) {
//         console.log(error);
//         return res.status(500).json({ error: 'Server error' });
//     }
// };


module.exports = {
  registerUser,
  loginUser,
  updateUser,
  deactivateUser,
  updateUserRole,
  updateUserStatus,
  getCustomerProfile,
  getAllUsers,
  getSingleUser,
  createAdmin
};