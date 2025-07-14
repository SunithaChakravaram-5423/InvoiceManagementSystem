// authMiddleware.js
const jwt = require('jsonwebtoken');
const SECRET_KEY = 'ChakravaramSuperSecretKey@2005';
 // Make sure this matches your index.js

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer <token>"

  if (!token) {
    return res.status(401).json({ error: 'Access Denied: No token provided' });
  }

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    req.user = user; // Attach decoded user info to request
    next();
  });
}

module.exports = authenticateToken;
