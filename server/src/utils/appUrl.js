// Where the app lives, for links in emails.
//
// CLIENT_URL can arrive without a scheme — Render's `fromService … property:
// host` gives the bare hostname — and "dekker-group.onrender.com/jobs/x" in an
// href is read as a relative path, so the link lands nowhere. index.js already
// normalises the same value for CORS.
//
// Returns '' when it isn't set, so callers can leave the link out rather than
// send a broken one.
function appUrl() {
  const raw = (process.env.CLIENT_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

module.exports = { appUrl };
