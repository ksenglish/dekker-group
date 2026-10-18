// Per-person access, granted on top of a role.
//
// A sales or operations login is scoped to its own work: the jobs it's on, its
// own diary, its own quotes, and no Invoices or Leads at all. That is the right
// default and stays the default. But some people need more than their role
// without needing the keys to everything — a senior sales person who runs the
// team's diary, an operations lead who raises the invoices. Each of those is a
// tick box here rather than a promotion to admin.
//
// Admin passes every check by definition, so none of these need ticking for an
// admin and ticking them changes nothing.

// The catalogue. `label` and `help` are what the Users page shows, so this list
// is the single source of truth for both ends — add a key here and the checkbox
// appears, with no second list to keep in step.
//
// Keep this file free of app requires: it is loaded by controllers that the
// auth middleware also loads.
const PERMISSIONS = [
  {
    key: 'jobs.all',
    label: 'All jobs',
    help: "See and open every job, not only the ones they're assigned to.",
  },
  {
    key: 'schedule.all',
    label: "Whole team's diary",
    help: 'See everyone\u2019s appointments in the Schedule, not only their own.',
  },
  {
    key: 'quotes.all',
    label: 'All quotes',
    help: 'See and edit every quote, including on jobs they have nothing to do with.',
  },
  {
    key: 'timesheets.all',
    label: "Whole team's time",
    help: 'See and edit other team members\u2019 timesheets, and log time against them.',
  },
  {
    key: 'invoices',
    label: 'Invoices',
    help: 'Open the Invoices section and the PDF Check inbox.',
  },
  {
    key: 'leads',
    label: 'New Leads',
    help: 'Open the New Leads section and work the enquiries in it.',
  },
  {
    key: 'reports.all',
    label: 'Whole-team reports',
    help: 'Reports cover the whole team rather than only their own jobs and hours.',
  },
];

const KEYS = PERMISSIONS.map(p => p.key);

// Which roles these grants are offered to. Admin already has everything;
// subcontractors are deliberately left out — their access is their own work on
// site, and widening it is a different conversation.
const GRANTABLE_ROLES = ['sales', 'operations'];

// Does this user have this door open?
//
// Admin is checked on the raw role on purpose: normaliseRole never turns
// anything else into 'admin', so this is the same test without the dependency.
function can(user, key) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.permissions?.[key] === true;
}

// Whatever arrived over the wire, reduced to known keys that are actually on.
// An unknown key grants nothing and is dropped rather than stored, so the
// column can't accumulate junk or a key some future release gives meaning to.
function cleanPermissions(input) {
  const out = {};
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const key of KEYS) if (input[key] === true) out[key] = true;
  }
  return out;
}

// Gate a route on a permission, optionally letting some raw roles straight
// through. Used where a whole section used to be role-walled: the roles that
// always had it keep it, and anyone ticked in gets the same door.
function requirePermission(key, ...orRawRoles) {
  return (req, res, next) => {
    if (req.user && (orRawRoles.includes(req.user.role) || can(req.user, key))) return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}

module.exports = { PERMISSIONS, KEYS, GRANTABLE_ROLES, can, cleanPermissions, requirePermission };
