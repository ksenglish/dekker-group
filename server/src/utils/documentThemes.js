const pool = require('../db/pool');

function themeRowToJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    companyName: row.company_name,
    gstNumber: row.gst_number,
    contactDetails: row.contact_details,
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

async function getDefaultTheme() {
  const { rows } = await pool.query('SELECT * FROM document_themes WHERE is_default=true LIMIT 1');
  return themeRowToJson(rows[0]);
}

// Used everywhere a quote/invoice needs its own branding rather than the
// global default — falls back to the default theme if the document has no
// theme_id yet (pre-migration rows) or its theme was since deleted.
async function getThemeById(id) {
  if (!id) return getDefaultTheme();
  const { rows } = await pool.query('SELECT * FROM document_themes WHERE id=$1', [id]);
  return themeRowToJson(rows[0]) || getDefaultTheme();
}

module.exports = { themeRowToJson, getDefaultTheme, getThemeById };
