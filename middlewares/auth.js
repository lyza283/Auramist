const jwt = require("jsonwebtoken");

exports.isAuthenticatedUser = (req, res, next) => {
    try {
        // Check for Authorization header
        const authHeader = req.header('Authorization');
        if (!authHeader) {
            return res.status(401).json({ 
                success: false,
                message: 'Please login to access this resource' 
            });
        }

        // Extract token
        const token = authHeader.split(' ')[1];
        if (!token) {
            return res.status(401).json({ 
                success: false,
                message: 'Invalid authorization token format' 
            });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Attach user to request
        req.user = decoded;
        next();
    } catch (error) {
        // Handle different JWT errors specifically
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                success: false,
                message: 'Session expired. Please login again' 
            });
        }
        return res.status(401).json({ 
            success: false,
            message: 'Invalid or malformed token' 
        });
    }
};

exports.authorizeRoles = (...roles) => {
    return (req, res, next) => {
        try {
            if (!roles.includes(req.user.role)) {
                return res.status(403).json({ 
                    success: false,
                    message: `Role (${req.user.role}) is not allowed to access this resource` 
                });
            }
            next();
        } catch (error) {
            return res.status(500).json({ 
                success: false,
                message: 'Internal server error during authorization' 
            });
        }
    };
};