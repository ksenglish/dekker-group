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

// A link to one file that a browser can simply navigate to.
//
// Safari on an iPad will not render a PDF handed to it as a blob in a new tab,
// and blocks a window opened after an await. Both of those go away if the file
// is a real URL returning a real PDF — but the API is authenticated by a header
// a plain navigation cannot send. So the permission travels in the link
// instead: one file, a few minutes, and nothing else.
function signFileToken(scope, id) {
  return jwt.sign({ sub: String(id), scope, purpose: 'file' }, process.env.JWT_SECRET,
    { expiresIn: process.env.FILE_LINK_EXPIRES_IN || '10m' });
}

function verifyFileToken(token, scope, id) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.purpose !== 'file') throw new Error('Invalid token purpose');
  if (decoded.scope !== scope) throw new Error('Token is not for this kind of file');
  // Named rather than implied: a token for one document must not open another.
  if (String(decoded.sub) !== String(id)) throw new Error('Token is not for this file');
  return decoded;
}

module.exports = {
  signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken,
  signOtpToken, verifyOtpToken, signFileToken, verifyFileToken,
};
