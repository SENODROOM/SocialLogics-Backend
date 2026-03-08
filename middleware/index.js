const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

// ─── Async wrapper ────────────────────────────────────────────────────────────
const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ─── Rate limiters ────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { success: false, error: 'Too many auth attempts, please try again later.' },
});

// ─── Auth middleware ──────────────────────────────────────────────────────────
// Lazy-require User to avoid circular dep issues at startup
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer '))
    token = req.headers.authorization.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'Not authorized, no token' });
  try {
    const { User } = require('../models');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) return res.status(401).json({ success: false, error: 'User not found' });
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Token invalid or expired' });
  }
};

const optionalAuth = async (req, res, next) => {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    const token = req.headers.authorization.split(' ')[1];
    try {
      const { User } = require('../models');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
    } catch {}
  }
  next();
};

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ success: false, error: 'Admin access required' });
  next();
};

// ─── Error handler ────────────────────────────────────────────────────────────
const errorHandler = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  console.error(`[ERROR] ${err.message}`);
  res.status(status).json({
    success: false,
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = { asyncHandler, apiLimiter, authLimiter, protect, optionalAuth, adminOnly, errorHandler };
