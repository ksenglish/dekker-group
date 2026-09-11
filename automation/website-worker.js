#!/usr/bin/env node
/**
 * Dekker Air — Website Change Worker
 *
 * Watches the Dekker App for website changes someone has asked for, and makes
 * them with Claude Code. The person asking never opens a terminal; they type
 * what they want in the app's Website tab and check the preview afterwards.
 *
 * This runs on your Claude Code subscription, not on metered API credit, which
 * is the entire reason the work happens out here instead of on the server. The
 * server has no AI in it at all — it holds the queue and the answers.
 *
 * What one job looks like:
 *   1. Claim the oldest queued job from the app.
 *   2. Pull the latest staging branch in the local website checkout.
 *   3. Run Claude Code against the job's instruction.
 *   4. Push whatever it committed to staging; Cloudflare builds the preview.
 *   5. Post the summary, the commits and any app-content edits back to the app.
 *
 * SETUP (one-time):
 *   1. Install Claude Code and sign in with the subscription account:
 *        npm install -g @anthropic-ai/claude-code
 *        claude          (sign in, then quit)
 *   2. Make sure the website repo is cloned next to this one and can push:
 *        git -C ../dekkerair-website push origin staging
 *   3. Set these, either in the environment or in server/.env:
 *        DEKKER_API       https://dekker-group.onrender.com
 *        AUTOMATION_API_KEY   the same value as the Render env var
 *        WEBSITE_REPO_PATH    path to the website checkout (optional, defaults
 *                             to ../dekkerair-website next to this repo)
 *   4. Start it:
 *        node automation/website-worker.js
 *
 * Leave it running. It polls every 30 seconds and does nothing when the queue
 * is empty, so it is cheap to leave on. The app shows whether it is running, so
 * nobody queues work into a void when the machine is off.
 *
 * To have it survive a reboot, run it under a process manager (pm2, a Windows
 * scheduled task set to "run whether user is logged on or not", or a systemd
 * unit). It is stateless, so restarting it at any point is safe: a job caught
 * mid-flight is released by the server after half an hour and can be queued
 * again.
 */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../server/.env') });

const API = (process.env.DEKKER_API || 'https://dekker-group.onrender.com').replace(/\/$/, '');
const KEY = process.env.AUTOMATION_API_KEY || '';
const REPO = process.env.WEBSITE_REPO_PATH || path.join(__dirname, '../../dekkerair-website');
const BRANCH = process.env.WEBSITE_STAGING_BRANCH || 'staging';
const POLL_MS = Number(process.env.WEBSITE_WORKER_POLL_MS || 30000);
// A ceiling on one job. Claude Code stops itself well before this on anything
// sane; it exists so a job that goes wrong cannot hold the queue all day.
const JOB_TIMEOUT_MS = Number(process.env.WEBSITE_WORKER_TIMEOUT_MS || 15 * 60 * 1000);

// What Claude Code may do without being asked, as one comma-separated list —
// that is the shape --allowedTools takes. Editing the site and committing is
// the job; anything else is denied rather than waiting for a permission prompt
// nobody is sitting there to answer.
//
// The space before each * matters: "git diff *" is prefix matching, whereas
// "git diff*" would also match git diff-index.
const ALLOWED_TOOLS = [
  'Read', 'Edit', 'Write', 'Glob', 'Grep',
  'Bash(git add *)', 'Bash(git commit *)', 'Bash(git status *)',
  'Bash(git diff *)', 'Bash(git log *)',
  'Bash(npm run build)',
].join(',');

const RULES = `You are making a change to the Dekker Air marketing website (dekkerair.co.nz) on behalf of someone at the company who is not a developer.

Work only in this repository and in the app-content folder you have been given. Make the change, check it looks right, and commit it. Do not push — that is handled for you. Do not merge anything, and do not touch the live branch.

Files whose job is building or deploying the site are off limits: anything under .github, wrangler.toml, _headers, _redirects, and the lockfiles. If the change you have been asked for needs one of those, stop and say so instead.

Two of the site's content sets are not in this repository. They live in the app and have been written out as JSON files in the app-content folder. If the change is to the Latest Deals cards or to the calculator discounts, edit those JSON files rather than hunting for them in the code. Keep the existing shape of each record. Leave them alone otherwise.

House style: New Zealand English and spelling, prices in NZD, phone numbers in NZ format. Match the tone already on the site, which is warm and direct with no jargon and no hard sell. Match the surrounding code's style and formatting, and prefer the smallest change that does the job.

When you are done, finish your reply with a short paragraph for the person who asked, in plain language, saying what you changed and what they will see. No code, no file paths, no jargon. If you could not do part of it, say which part and why.`;

const log = (...a) => console.log(new Date().toLocaleTimeString('en-NZ'), ...a);

async function api(pathname, body) {
  const res = await fetch(`${API}/api/website${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error(`${pathname} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const git = (...args) =>
  execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim();

// Everything Claude Code committed while it was working, newest last. This is
// what the app shows as "what changed", so it is read back from git rather than
// taken from anything Claude said about itself.
function commitsSince(startSha) {
  if (git('rev-parse', 'HEAD') === startSha) return [];
  return git('log', '--format=%h%x1f%s', `${startSha}..HEAD`)
    .split('\n').filter(Boolean)
    .map(line => { const [sha, message] = line.split('\x1f'); return { sha, message }; })
    .reverse();
}

// Where Claude Code actually lives. An npm install leaves a claude.cmd shim on
// Windows, which Node refuses to spawn directly and mangles the arguments of
// when asked to go through a shell. Running it under cmd.exe with shell:false
// is the combination that passes spaces and brackets through intact — the
// allowed-tools list and the site's own path both contain them.
function claudeCommand(args) {
  if (process.platform !== 'win32') return { file: 'claude', argv: args };
  let resolved = 'claude';
  try {
    resolved = execFileSync('where', ['claude'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim() || 'claude';
  } catch { /* not on PATH; let the spawn report it */ }
  // A native install is an .exe and can be spawned on its own.
  if (/\.exe$/i.test(resolved)) return { file: resolved, argv: args };
  return { file: process.env.COMSPEC || 'cmd.exe', argv: ['/d', '/s', '/c', resolved, ...args] };
}

function runClaude(instruction, scratchDir) {
  const rulesFile = path.join(scratchDir, 'rules.md');
  fs.writeFileSync(rulesFile, RULES);

  // Deliberately not --bare: bare mode skips the subscription login and expects
  // an API key, which is the one thing this whole arrangement exists to avoid.
  const { file, argv } = claudeCommand([
    '-p', instruction,
    '--output-format', 'json',
    '--append-system-prompt-file', rulesFile,
    '--add-dir', path.join(scratchDir, 'app-content'),
    '--allowedTools', ALLOWED_TOOLS,
    // Nobody is watching, so anything that would prompt is denied rather than
    // left hanging until the timeout.
    '--permission-prompts', 'none',
    '--max-turns', '40',
    '--model', 'opus',
  ]);

  return new Promise((resolve, reject) => {
    const child = spawn(file, argv, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`gave up after ${Math.round(JOB_TIMEOUT_MS / 60000)} minutes`));
    }, JOB_TIMEOUT_MS);

    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      const raw = stdout + (stderr ? `\n--- stderr ---\n${stderr}` : '');
      if (code !== 0 && !stdout) return reject(new Error(stderr.slice(0, 400) || `claude exited with code ${code}`));
      try {
        const parsed = JSON.parse(stdout);
        resolve({ text: parsed.result || parsed.text || '', raw });
      } catch {
        // Better to hand back whatever it said than to fail a job it may well
        // have already done the work for.
        resolve({ text: stdout.slice(-4000), raw });
      }
    });
  });
}

async function runJob(job, appContent) {
  log(`job ${job.id.slice(0, 8)} — ${job.instruction.split('\n')[0].slice(0, 70)}`);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dekker-website-'));
  const contentDir = path.join(scratch, 'app-content');
  fs.mkdirSync(contentDir);
  // Written out as plain files so Claude Code edits them like anything else,
  // then read back to see which it actually touched.
  const before = {};
  for (const [key, value] of Object.entries(appContent || {})) {
    const text = JSON.stringify(value, null, 2);
    before[key] = text;
    fs.writeFileSync(path.join(contentDir, `${key}.json`), text);
  }

  // Start from whatever is live on staging, so a change is never built on a
  // stale copy of the site.
  git('checkout', BRANCH);
  git('pull', '--ff-only', 'origin', BRANCH);
  const startSha = git('rev-parse', 'HEAD');

  let status = 'done';
  let result;
  let raw = '';
  try {
    const out = await runClaude(job.instruction, scratch);
    result = out.text;
    raw = out.raw;
  } catch (err) {
    status = 'failed';
    result = `That did not finish: ${err.message.slice(0, 500)}`;
    raw = err.stdout || err.message;
  }

  const commits = commitsSince(startSha);

  // Push only what was actually committed. A job that changed nothing is not a
  // failure — the answer may have been "that is already how it reads".
  if (commits.length) {
    try {
      git('push', 'origin', BRANCH);
      log(`  pushed ${commits.length} commit(s) to ${BRANCH}`);
    } catch (err) {
      status = 'failed';
      result = `${result}\n\nThe change was made but could not be pushed: ${err.message.slice(0, 300)}`;
    }
  }

  // Only content that actually changed goes back, so an untouched key is not
  // rewritten and does not show up as an unpublished change in the app.
  const changed = {};
  for (const key of Object.keys(before)) {
    const now = fs.readFileSync(path.join(contentDir, `${key}.json`), 'utf8');
    if (now !== before[key]) {
      try { changed[key] = JSON.parse(now); }
      catch { status = 'failed'; result = `${result}\n\nThe ${key} file came back as invalid JSON, so it was not saved.`; }
    }
  }

  fs.rmSync(scratch, { recursive: true, force: true });

  await api(`/jobs/${job.id}/finish`, {
    status, result, commits, appContent: changed, log: raw.slice(-20000),
  });
  log(`  ${status}${Object.keys(changed).length ? `, updated ${Object.keys(changed).join(' and ')}` : ''}`);
}

async function tick() {
  const { job, appContent } = await api('/jobs/claim');
  if (!job) return false;
  try {
    await runJob(job, appContent);
  } catch (err) {
    log('  job failed outright:', err.message);
    // Reported rather than left running, or the app would show it stuck until
    // the server's half-hour timeout released it.
    await api(`/jobs/${job.id}/finish`, {
      status: 'failed', result: `Something went wrong on the worker: ${err.message.slice(0, 500)}`,
    }).catch(() => {});
  }
  return true;
}

(async () => {
  if (!KEY) { console.error('AUTOMATION_API_KEY is not set. See the setup notes at the top of this file.'); process.exit(1); }
  if (!fs.existsSync(path.join(REPO, '.git'))) {
    console.error(`No website checkout at ${REPO}. Clone it there or set WEBSITE_REPO_PATH.`);
    process.exit(1);
  }
  const check = claudeCommand(['--version']);
  try {
    execFileSync(check.file, check.argv, { stdio: 'ignore' });
  } catch {
    console.error('Claude Code is not installed, or not on PATH. See the setup notes at the top of this file.');
    process.exit(1);
  }

  log(`watching ${API} for website jobs`);
  log(`site checkout: ${REPO} (${BRANCH})`);

  for (;;) {
    try {
      // Keep taking jobs while there are any, so a backlog clears in one go
      // rather than one per poll.
      while (await tick());
    } catch (err) {
      log('could not reach the app:', err.message);
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
})();
