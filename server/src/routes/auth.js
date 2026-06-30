const express = require('express');
const router = express.Router();
const {
  login, verifyOtp, resendOtp, getLoginHistory,
  refresh, logout, me,
  forgotPassword, checkResetToken, setPassword, changePassword,
} = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

router.post('/login', login);
router.post('/verify-otp', verifyOtp);
router.post('/resend-otp', resendOtp);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', authenticate, me);
router.get('/login-history', authenticate, getLoginHistory);
router.post('/forgot-password', forgotPassword);
router.get('/reset-token/:token', checkResetToken);
router.post('/set-password', setPassword);
router.post('/change-password', authenticate, changePassword);

module.exports = router;
