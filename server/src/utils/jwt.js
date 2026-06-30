const jwt = require('jsonwebtoken');

function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

function signOtpToken(userId, email) {
  return jwt.sign({ id: userId, email, purpose: 'otp' }, process.env.JWT_SECRET, { expiresIn: '10m' });
}

function verifyOtpToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.purpose !== 'otp') throw new Error('Invalid token purpose');
  return decoded;
}

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, signOtpToken, verifyOtpToken };
