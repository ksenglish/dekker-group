const { verifyAccessToken } = require('../utils/jwt');

// Map new role names to their permission equivalents
// sales/operations behave like 'office'; subcontractor behaves like 'field_tech'
function normaliseRole(role) {
  if (role === 'sales' || role === 'operations') return 'office';
  if (role === 'subcontractor') return 'field_tech';
  return role;
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(403).json({ error: 'Insufficient permissions' });
    const effective = normaliseRole(req.user.role);
    if (!roles.includes(req.user.role) && !roles.includes(effective)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole, normaliseRole };
