// The address that gets a copy of anything worth filing — signed Electrical
// COCs, and quote accept/decline notifications. Overridable via env so it can
// be changed without a deploy.
const OFFICE_RECORDS_EMAIL = process.env.RECORDS_EMAIL || 'office@dekkergroup.co.nz';

module.exports = { OFFICE_RECORDS_EMAIL };
