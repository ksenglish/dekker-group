const express = require('express');
const router = express.Router();
const { login, refresh, logout, me, forgotPassword, checkResetToken, setPassword } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', authenticate, me);
router.post('/forgot-password', forgotPassword);
router.get('/reset-token/:token', checkResetToken);
router.post('/set-password', setPassword);

module.exports = router;
