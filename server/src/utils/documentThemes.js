const pool = require('../db/pool');

// The only two words a document can call itself. Anything else — including an
// older row written before the column existed — reads as a Quote.
const DOCUMENT_TYPES = ['Quote', 'Estimate'];
const documentTypeOf = theme => (DOCUMENT_TYPES.includes(theme?.documentType) ? theme.documentType : 'Quote');

function themeRowToJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    documentType: DOCUMENT_TYPES.includes(row.document_type) ? row.document_type : 'Quote',
    emailTemplateId: row.email_template_id,
    companyName: row.company_name,
    gstNumber: row.gst_number,
    contactDetails: row.contact_details,
    paymentTerms: row.payment_terms,
    termsAndConditions: row.terms_and_conditions,
    quoteDescription: row.quote_description,
    brandColour: row.brand_colour,
    logoBase64: row.logo_base64,
    logoSize: row.logo_size,
    logoPosition: row.logo_position,
    contactPosition: row.contact_position,
    transparentHeader: row.transparent_header,
    footerLine1: row.footer_line1,
    footerLine2: row.footer_line2,
    isDefault: row.is_default,
    archived: row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// What a document falls back to when there is nothing else — no theme on it,
// its theme deleted, and none marked default.
//
// Blank rather than invented: an empty company name prints nothing, where a
// made-up one would print the wrong business on a customer's quote. The point
// is that every caller gets an object, because they all read fields straight
// off it — `docTheme.paymentTerms` on a null brought down the whole public
// quote page, and the page told the customer their link had expired.
const BARE_THEME = {
  id: null, name: 'Default', documentType: 'Quote',
  emailTemplateId: null, companyName: '', gstNumber: '', contactDetails: '',
  paymentTerms: '', termsAndConditions: '', quoteDescription: '',
  brandColour: '#1e40af', logoBase64: null, logoSize: null, logoPosition: null,
  contactPosition: null, transparentHeader: false,
  footerLine1: '', footerLine2: '', isDefault: false, archived: false,
};

async function getDefaultTheme() {
  const { rows } = await pool.query('SELECT * FROM document_themes WHERE is_default=true LIMIT 1');
  // Any theme at all beats none: a business with themes but none ticked
  // default should still print on one of its own rather than on nothing.
  if (!rows[0]) {
    const { rows: any } = await pool.query(
      'SELECT * FROM document_themes WHERE archived IS NOT TRUE ORDER BY created_at LIMIT 1');
    return themeRowToJson(any[0]) || { ...BARE_THEME };
  }
  return themeRowToJson(rows[0]) || { ...BARE_THEME };
}

// Used everywhere a quote/invoice needs its own branding rather than the
// global default — falls back to the default theme if the document has no
// theme_id yet (pre-migration rows) or its theme was since deleted.
async function getThemeById(id) {
  if (!id) return getDefaultTheme();
  const { rows } = await pool.query('SELECT * FROM document_themes WHERE id=$1', [id]);
  return themeRowToJson(rows[0]) || getDefaultTheme();
}

// The branding a job documents itself with.
//
// In order of how specific it is: the theme on the quote the job was won on,
// since that is the document the customer already has in their inbox; then
// the theme the job type sets, which is where a quote got its own from; then
// the house default. Shared so the service report, the job form and anything
// else printed off a job cannot pick differently and arrive looking like two
// companies.
//
// Takes the job row rather than an id, because callers have already loaded it.
async function getThemeForJob(job) {
  if (!job) return getDefaultTheme();
  const { rows } = await pool.query(
    `SELECT theme_id FROM quotes
      WHERE job_id = $1 AND status = 'accepted' AND theme_id IS NOT NULL
      ORDER BY accepted_at DESC NULLS LAST, updated_at DESC LIMIT 1`,
    [job.id]
  );
  if (rows[0]?.theme_id) return getThemeById(rows[0].theme_id);

  // require() here rather than at the top: jobTypes requires the pool, and the
  // pool is what the test harness swaps out underneath this module.
  const { findJobType } = require('../services/jobTypes');
  const type = job.type ? await findJobType(job.type) : null;
  if (type?.theme_id) {
    const theme = await getThemeById(type.theme_id);
    if (theme) return theme;
  }
  return getDefaultTheme();
}

module.exports = {
  themeRowToJson, getDefaultTheme, getThemeById, getThemeForJob,
  documentTypeOf, DOCUMENT_TYPES,
};
