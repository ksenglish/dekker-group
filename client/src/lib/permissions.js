// Shared role checks for Customers, Jobs, and Schedule permissions.
// Mirrors the equivalent checks in server/src/middleware/auth.js.
//
// Three tiers: admin (full edit/delete), sales/operations/office (can create
// and do routine actions like status changes, rescheduling, notes — and edit
// customer details), field_tech/subcontractor (view only).
const VIEW_ONLY_ROLES = ['field_tech', 'subcontractor'];
// The roles the server's requireRole('admin', 'office') lets through — sales
// and operations both normalise to office in middleware/auth.js.
const OFFICE_LEVEL_ROLES = ['admin', 'office', 'sales', 'operations'];

export function isAdmin(role) { return role === 'admin'; }
export function canAct(role) { return !VIEW_ONLY_ROLES.includes(role); }

// Whoever can create a customer can also correct one. Deleting and merging
// stay admin-only — those lose or rewrite history, editing a phone number
// doesn't.
export function canEditCustomer(role) { return OFFICE_LEVEL_ROLES.includes(role); }

// ── Extra access granted to one person, on top of their role ────────────────
//
// The server decides what anyone can actually reach; this only decides what to
// put on screen, so nobody is shown a section that will refuse them. The
// catalogue of keys and their wording lives on the server
// (server/src/utils/permissions.js) and the Users page fetches it, so there is
// no second copy of it here to drift.
export function can(user, key) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.permissions?.[key] === true;
}
