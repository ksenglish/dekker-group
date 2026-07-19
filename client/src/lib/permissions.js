// Shared role checks for Customers, Jobs, and Schedule permissions.
// Mirrors the equivalent checks in server/src/middleware/auth.js.
//
// Three tiers: admin (full edit/delete), sales/operations/office (can create
// and do routine actions like status changes, rescheduling, notes — but not
// edit or delete the core record), field_tech/subcontractor (view only).
const VIEW_ONLY_ROLES = ['field_tech', 'subcontractor'];

export function isAdmin(role) { return role === 'admin'; }
export function canAct(role) { return !VIEW_ONLY_ROLES.includes(role); }
