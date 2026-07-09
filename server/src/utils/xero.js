// Xero OAuth2 (Authorization Code / "Web app" flow) + Accounting API client.
// Unlike ArcSite's static bearer token, Xero's refresh_token ROTATES on every
// use — a new one is issued each refresh and the old one is immediately dead.
// Getting that persistence wrong silently loses the connection, so this uses
// Xero's official SDK (xero-node) rather than a hand-rolled fetch wrapper.
const pool = require('../db/pool');
const { XeroClient } = require('xero-node');

const SCOPES = 'accounting.contacts accounting.invoices accounting.payments accounting.settings offline_access'.split(' ');
const REFRESH_MARGIN_MS = 2 * 60 * 1000; // refresh if less than 2 minutes of life left

function baseConfig(extra = {}) {
  return {
    clientId: process.env.XERO_CLIENT_ID,
    clientSecret: process.env.XERO_CLIENT_SECRET,
    redirectUris: [process.env.XERO_REDIRECT_URI],
    scopes: SCOPES,
    ...extra,
  };
}

async function getXeroConnection() {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key='xero_connection'`);
  return rows[0]?.value || null;
}

async function saveXeroConnection(partial) {
  const current = (await getXeroConnection()) || {};
  const updated = { ...current, ...partial };
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('xero_connection', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
    [JSON.stringify(updated)]
  );
  return updated;
}

async function clearXeroConnection() {
  await pool.query(`DELETE FROM settings WHERE key='xero_connection'`);
}

async function buildAuthorizeUrl(state) {
  const client = new XeroClient(baseConfig({ state }));
  await client.initialize();
  return client.buildConsentUrl();
}

// Exchange the ?code on Xero's redirect for a token set, resolve the
// connected organisation (tenant), and persist the connection.
// `expectedState` must be the same value passed to buildAuthorizeUrl() for
// this round trip — the SDK's underlying openid-client verifies the
// callback's `state` param against it and throws on mismatch, which is our
// CSRF protection (callbackUrl only needs its query string intact, it
// doesn't need to be a fully reconstructed public URL).
async function completeConnection(callbackUrl, expectedState, connectedBy) {
  const client = new XeroClient(baseConfig({ state: expectedState }));
  await client.initialize();
  const tokenSet = await client.apiCallback(callbackUrl);
  client.setTokenSet(tokenSet);

  const tenants = await client.updateTenants(false);
  if (!tenants.length) throw new Error('No Xero organisation was authorised');
  if (tenants.length > 1) console.warn(`Xero: ${tenants.length} organisations connected — using the first (${tenants[0].tenantName})`);
  const tenant = tenants[0];

  return saveXeroConnection({
    connectionId: tenant.id,
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
    accessToken: tokenSet.access_token,
    refreshToken: tokenSet.refresh_token,
    expiresAt: Date.now() + tokenSet.expires_in * 1000,
    connectedAt: new Date().toISOString(),
    connectedBy: connectedBy || null,
  });
}

// Returns { client, tenantId } with a guaranteed-fresh access token,
// refreshing (and persisting the rotated refresh_token) first if needed.
// Every Xero API call in this app must go through this helper.
async function getAuthenticatedClient() {
  const conn = await getXeroConnection();
  if (!conn) throw new Error('Xero is not connected');

  const client = new XeroClient(baseConfig());
  await client.initialize();
  client.setTokenSet({
    access_token: conn.accessToken,
    refresh_token: conn.refreshToken,
    expires_at: Math.floor(conn.expiresAt / 1000),
  });

  if (!conn.expiresAt || conn.expiresAt < Date.now() + REFRESH_MARGIN_MS) {
    const refreshed = await client.refreshToken();
    await saveXeroConnection({
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: Date.now() + refreshed.expires_in * 1000,
    });
  }

  return { client, tenantId: conn.tenantId };
}

async function createOrUpdateInvoice(invoiceBody, existingXeroInvoiceId) {
  const { client, tenantId } = await getAuthenticatedClient();
  const payload = { invoices: [invoiceBody] };
  const res = existingXeroInvoiceId
    ? await client.accountingApi.updateInvoice(tenantId, existingXeroInvoiceId, payload)
    : await client.accountingApi.createInvoices(tenantId, payload);
  return res.body.invoices[0];
}

async function getInvoice(xeroInvoiceId) {
  const { client, tenantId } = await getAuthenticatedClient();
  const res = await client.accountingApi.getInvoice(tenantId, xeroInvoiceId);
  return res.body.invoices[0];
}

const escapeForWhere = v => String(v).replace(/"/g, '\\"');

// Search Xero for an existing contact by email then name; create one if
// neither matches. Recommend future callers persist the returned ContactID
// onto customers.xero_contact_id so repeat pushes skip this search entirely.
async function findOrCreateContact(customer) {
  const { client, tenantId } = await getAuthenticatedClient();

  if (customer.email) {
    const res = await client.accountingApi.getContacts(tenantId, undefined, `EmailAddress=="${escapeForWhere(customer.email)}"`);
    if (res.body.contacts?.length) return res.body.contacts[0];
  }
  if (customer.name) {
    const res = await client.accountingApi.getContacts(tenantId, undefined, `Name=="${escapeForWhere(customer.name)}"`);
    if (res.body.contacts?.length) return res.body.contacts[0];
  }

  const created = await client.accountingApi.createContacts(tenantId, {
    contacts: [{
      name: customer.name,
      emailAddress: customer.email || undefined,
      phones: customer.phone ? [{ phoneType: 'DEFAULT', phoneNumber: customer.phone }] : undefined,
      addresses: customer.address_street ? [{
        addressType: 'STREET',
        addressLine1: customer.address_street,
        city: customer.address_city,
        region: customer.address_region,
        postalCode: customer.address_postcode,
      }] : undefined,
    }],
  });
  return created.body.contacts[0];
}

async function getContact(xeroContactId) {
  const { client, tenantId } = await getAuthenticatedClient();
  const res = await client.accountingApi.getContact(tenantId, xeroContactId);
  return res.body.contacts[0];
}

async function listAccounts() {
  const { client, tenantId } = await getAuthenticatedClient();
  const res = await client.accountingApi.getAccounts(tenantId);
  return res.body.accounts;
}

async function listTaxRates() {
  const { client, tenantId } = await getAuthenticatedClient();
  const res = await client.accountingApi.getTaxRates(tenantId);
  return res.body.taxRates;
}

// Best-effort org-side revoke — a failure here shouldn't block clearing the
// local connection, so callers should still clearXeroConnection() afterward.
async function revokeConnection() {
  const conn = await getXeroConnection();
  if (!conn?.connectionId) return;
  const { client } = await getAuthenticatedClient();
  await client.disconnect(conn.connectionId);
}

module.exports = {
  getXeroConnection, saveXeroConnection, clearXeroConnection,
  buildAuthorizeUrl, completeConnection, getAuthenticatedClient,
  createOrUpdateInvoice, getInvoice,
  findOrCreateContact, getContact,
  listAccounts, listTaxRates,
  revokeConnection,
};
