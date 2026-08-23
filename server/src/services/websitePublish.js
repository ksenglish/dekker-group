// Publishing the marketing site from inside Dekker App.
//
// Website changes land on a staging branch, which Cloudflare Pages builds to
// its own URL. Publishing merges that branch into the production one, which
// Cloudflare then builds to dekkerair.co.nz. Both of those are GitHub
// operations, so this talks to the GitHub API rather than shelling out to git —
// the server has no checkout of the site to work in.
//
// Needs a token with permission to push to the site repository, set as
// GITHUB_TOKEN. Without one everything here reports "not configured" rather
// than failing, so the rest of the Website section still works.
const REPO = process.env.WEBSITE_REPO || 'ksenglish/dekkerair-website';
const TOKEN = process.env.GITHUB_TOKEN || '';
const STAGING_BRANCH = process.env.WEBSITE_STAGING_BRANCH || 'staging';
const LIVE_BRANCH = process.env.WEBSITE_LIVE_BRANCH || 'main';
const PREVIEW_URL = process.env.WEBSITE_PREVIEW_URL || 'https://staging.dekkerair-website.pages.dev';
const LIVE_URL = process.env.WEBSITE_LIVE_URL || 'https://dekkerair.co.nz';

const isConfigured = () => Boolean(TOKEN);

async function github(path, options = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dekker-app',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
  return { ok: res.ok, status: res.status, body };
}

// What's sitting on staging that isn't live yet.
async function status() {
  const base = { configured: isConfigured(), previewUrl: PREVIEW_URL, liveUrl: LIVE_URL, repo: REPO };
  if (!isConfigured()) return { ...base, pending: [], behind: 0 };

  const res = await github(`/compare/${LIVE_BRANCH}...${STAGING_BRANCH}`);
  if (!res.ok) {
    return { ...base, pending: [], behind: 0, error: res.body?.message || `GitHub returned ${res.status}` };
  }

  return {
    ...base,
    // `ahead_by` counts staging's commits that main doesn't have — the changes
    // waiting to be published.
    pending: (res.body.commits || []).map(c => ({
      sha: c.sha.slice(0, 7),
      message: (c.commit.message || '').split('\n')[0],
      author: c.commit.author?.name || null,
      date: c.commit.author?.date || null,
    })).reverse(),
    behind: res.body.behind_by || 0,
  };
}

// Merge staging into the live branch. Cloudflare takes it from there.
async function publish(userName) {
  if (!isConfigured()) return { ok: false, error: 'Publishing is not configured' };

  const res = await github('/merges', {
    method: 'POST',
    body: JSON.stringify({
      base: LIVE_BRANCH,
      head: STAGING_BRANCH,
      commit_message: `Publish website${userName ? ` (published by ${userName})` : ''}`,
    }),
  });

  // 204 means there was nothing to merge — already up to date, not a failure.
  if (res.status === 204) return { ok: true, alreadyUpToDate: true };
  if (res.status === 409) return { ok: false, error: 'The branches have conflicting changes and need merging by hand.' };
  if (!res.ok) return { ok: false, error: res.body?.message || `GitHub returned ${res.status}` };

  return { ok: true, sha: res.body?.sha?.slice(0, 7) || null };
}

module.exports = { isConfigured, status, publish, PREVIEW_URL, LIVE_URL, STAGING_BRANCH, LIVE_BRANCH };
