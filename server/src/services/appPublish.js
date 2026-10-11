// Publishing a change to the app itself.
//
// The worker commits to a branch and pushes it. Publishing merges that branch
// into main, which is what Render builds and deploys — so the whole of
// "publish" is one GitHub call, and the deploy that follows is the same one
// that happens whenever anyone pushes.
//
// The server has no checkout of itself to work in, so this talks to the GitHub
// API rather than shelling out to git — the same arrangement the website's
// publishing uses.
//
// Needs a token with permission to push to the repository, as GITHUB_TOKEN.
// Without one everything here reports "not configured" rather than failing, so
// the console still shows the queue and the evidence.
const REPO = process.env.APP_REPO || 'ksenglish/dekker-group';
const TOKEN = process.env.GITHUB_TOKEN || '';
const LIVE_BRANCH = process.env.APP_LIVE_BRANCH || 'main';
const LIVE_URL = process.env.APP_LIVE_URL || 'https://app.dekkerair.co.nz';

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

// What is sitting on a job's branch that is not live yet. Shown before anyone
// publishes, so the list of commits is the last word rather than the summary.
async function status(branch) {
  const base = { configured: isConfigured(), liveUrl: LIVE_URL, repo: REPO, branch: branch || null };
  if (!isConfigured()) return { ...base, pending: [], behind: 0 };
  if (!branch) return { ...base, pending: [], behind: 0 };

  const res = await github(`/compare/${encodeURIComponent(LIVE_BRANCH)}...${encodeURIComponent(branch)}`);
  if (!res.ok) {
    return {
      ...base, pending: [], behind: 0,
      error: res.status === 404
        ? 'That branch is not on GitHub. The worker may not have pushed it yet.'
        : res.body?.message || `GitHub returned ${res.status}`,
    };
  }
  return {
    ...base,
    behind: res.body.ahead_by || 0,
    pending: (res.body.commits || []).map(c => ({
      sha: c.sha.slice(0, 7),
      message: (c.commit?.message || '').split('\n')[0],
      at: c.commit?.author?.date || null,
    })),
  };
}

// Merge the branch into main. Render picks it up from there, so there is
// nothing else to trigger.
async function publish(branch, who) {
  if (!isConfigured()) {
    return { ok: false, error: 'No GitHub token is set on the server, so nothing can be published from here.' };
  }
  if (!branch) return { ok: false, error: 'This change has no branch to publish.' };

  const res = await github('/merges', {
    method: 'POST',
    body: JSON.stringify({
      base: LIVE_BRANCH,
      head: branch,
      commit_message: `Publish app change from ${branch}${who ? ` (approved by ${who})` : ''}`,
    }),
  });

  // 204 is GitHub's "nothing to merge" — already live, which is a fine outcome
  // to report as success rather than as an error nobody can act on.
  if (res.status === 204) return { ok: true, alreadyLive: true, liveUrl: LIVE_URL };
  if (res.status === 409) {
    return {
      ok: false,
      error: 'That change conflicts with what is already live. It needs a developer to sort out before it can go on.',
    };
  }
  if (!res.ok) return { ok: false, error: res.body?.message || `GitHub returned ${res.status}` };

  return { ok: true, sha: res.body?.sha?.slice(0, 7) || null, liveUrl: LIVE_URL };
}

module.exports = { status, publish, isConfigured, LIVE_BRANCH, LIVE_URL, REPO };
