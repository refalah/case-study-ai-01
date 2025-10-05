const rateLimit = require("express-rate-limit");

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 uploads per window
  message: { error: "Too many uploads, please try again later" }
});

const evaluateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many evaluation requests, please try again later" }
});

module.exports = {
  uploadLimiter,
  evaluateLimiter
};