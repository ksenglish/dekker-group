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

// Invoices and Leads used to take an exact-role check here, to stop sales and
// operations arriving via the office equivalence above. They now use
// requirePermission in utils/permissions, which keeps them out by default and
// can be opened for one person — so nothing wants a raw-role check any more.

// Accepts either a user JWT or the AUTOMATION_API_KEY env var in X-API-Key header
function authenticateAutomation(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === process.env.AUTOMATION_API_KEY) {
    req.user = { id: 'automation', role: 'admin', name: 'Automation' };
    return next();
  }
  return authenticate(req, res, next);
}

module.exports = { authenticate, requireRole, normaliseRole, authenticateAutomation };
