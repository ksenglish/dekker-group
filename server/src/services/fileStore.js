// Object storage for attachment bytes.
//
// Files used to live in the database as base64, which made a big drawing a very
// large single statement — a 17MB ArcSite export was enough to take Postgres
// down. Bytes now go to a bucket and the database keeps only the record.
//
// R2 speaks the S3 API, so the same client works against S3 or anything else
// S3-compatible if that is ever wanted.
//
// Without credentials configured this falls back to storing base64 in the
// database exactly as before. That keeps local development working with no
// bucket, and means a missing credential degrades to the old behaviour rather
// than breaking uploads outright.

const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

const BUCKET = process.env.R2_BUCKET;
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
// S3 rather than R2, or a self-hosted MinIO, can be pointed at directly.
const ENDPOINT = process.env.R2_ENDPOINT
  || (ACCOUNT_ID ? `https://${ACCOUNT_ID}.r2.cloudflarestorage.com` : null);

const configured = Boolean(BUCKET && ACCESS_KEY_ID && SECRET_ACCESS_KEY && ENDPOINT);

let client = null;
function s3() {
  if (!client) {
    client = new S3Client({
      region: process.env.R2_REGION || 'auto',
      endpoint: ENDPOINT,
      credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    });
  }
  return client;
}

function isConfigured() { return configured; }

// Keys are prefixed by what owns the file so a bucket listing is readable, and
// carry a random component so re-pulling the same drawing never collides with a
// copy still being read.
function buildKey(prefix, filename) {
  const safe = String(filename || 'file')
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(-100);
  return `${prefix}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safe}`;
}

async function putObject({ prefix, filename, buffer, contentType }) {
  const key = buildKey(prefix, filename);
  await s3().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
  }));
  return key;
}

async function getObject(key) {
  const res = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  // The content type comes back off the object, so nothing has to carry a
  // second column recording what kind of file a key points at.
  return { buffer: Buffer.concat(chunks), contentType: res.ContentType || 'application/octet-stream' };
}

// What kind of file a key points at, without pulling the file. Brochure keys
// carry no extension, so the object's own content type is the only record of
// it — and a page laying out a brochure needs to know whether to show an image
// or a PDF viewer before it fetches anything.
async function headContentType(key) {
  if (!key) return null;
  try {
    const res = await s3().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return res.ContentType || null;
  } catch {
    return null;
  }
}

async function getObjectBuffer(key) {
  return (await getObject(key)).buffer;
}

// Deleting the record matters more than reclaiming the space, so a failure here
// is logged and swallowed — an orphaned object is a tidy-up job, whereas
// throwing would leave the row behind and the file undeletable from the app.
async function deleteObject(key) {
  if (!key || !configured) return;
  try {
    await s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err) {
    console.error('Could not delete stored file', key, err.message);
  }
}

const stripDataUrl = value => String(value).replace(/^data:[^;]+;base64,/, '');

// Reading a row's bytes without the caller having to care where they ended up.
// Rows written before the bucket existed still carry their own base64.
async function readAttachmentBuffer(row) {
  if (row.storage_key) return getObjectBuffer(row.storage_key);
  if (row.data_base64) return Buffer.from(stripDataUrl(row.data_base64), 'base64');
  throw new Error('Attachment has no stored file');
}

// The quote PDF builder embeds images as data URLs, so bucket-backed rows have
// to be turned back into one at read time.
async function readAttachmentDataUrl(row) {
  if (!row.storage_key) return row.data_base64;
  const buffer = await getObjectBuffer(row.storage_key);
  return `data:${row.mime_type || 'application/octet-stream'};base64,${buffer.toString('base64')}`;
}

// ── Data-URL columns ─────────────────────────────────────────────────────────
// Everything else in the app that holds a file — receipt scans, product images,
// brochures — stores it as a data URL in its own differently-named column. The
// helpers below work off a plain {key, inline} pair so each of those can move
// to the bucket without fileStore needing to know the column names.

const mimeOfDataUrl = value => (String(value).match(/^data:([^;]+);base64,/) || [])[1] || 'application/octet-stream';

// Returns the key to store, or null when there is no bucket — in which case the
// caller keeps writing the data URL into its column exactly as before.
async function storeDataUrl({ prefix, filename, dataUrl }) {
  if (!configured || !dataUrl) return null;
  const contentType = mimeOfDataUrl(dataUrl);
  const buffer = Buffer.from(stripDataUrl(dataUrl), 'base64');
  const key = await putObject({ prefix, filename: filename || 'file', buffer, contentType });
  return { key, size: buffer.length, contentType };
}

async function readBytes({ key, inline }) {
  if (key) return getObjectBuffer(key);
  if (inline) return Buffer.from(stripDataUrl(inline), 'base64');
  throw new Error('No stored file');
}

// Several callers still want a data URL specifically — the PDF builder embeds
// product images that way, and it decides brochure handling by looking at the
// mime prefix. Rebuilt from the object's own content type.
async function readDataUrl({ key, inline }) {
  if (!key) return inline || null;
  const { buffer, contentType } = await getObject(key);
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

module.exports = {
  isConfigured,
  putObject,
  getObject,
  getObjectBuffer,
  headContentType,
  deleteObject,
  readAttachmentBuffer,
  readAttachmentDataUrl,
  storeDataUrl,
  readBytes,
  readDataUrl,
  stripDataUrl,
};
