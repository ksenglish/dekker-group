// The address that gets a copy of anything worth filing — signed Electrical
// COCs, and quote accept/decline notifications. Overridable via env so it can
// be changed without a deploy.
const OFFICE_RECORDS_EMAIL = process.env.RECORDS_EMAIL || 'office@dekkergroup.co.nz';

// Where a customer replying to a quote should land. Kept on the Reply-To of
// outgoing quotes alongside the person who sent it, so a reply reaches both the
// rep who knows the job and the shared inbox that catches it if they're away.
const SALES_EMAIL = process.env.SALES_EMAIL || 'sales@dekkergroup.co.nz';

module.exports = { OFFICE_RECORDS_EMAIL, SALES_EMAIL };
