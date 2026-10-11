#!/usr/bin/env node
/**
 * Dekker App — App Change Worker
 *
 * The same arrangement as the website worker, pointed at the app itself. The
 * office asks for a change in their own words in the App Updates tab; this runs
 * Claude Code against a checkout of this repository and posts back what it did,
 * what the checks said and what the screen looked like afterwards.
 *
 * Runs on your Claude Code subscription, not on metered API credit, which is
 * why the work happens out here instead of on the server. The server has no AI
 * in it at all — it holds the queue and the answers.
 *
 * WHAT IS DIFFERENT FROM THE WEBSITE WORKER
 *
 *   The website previews on a Cloudflare branch build. The app is one service
 *   with one database behind it, so there is nothing to point a preview at.
 *   Instead each job is judged on evidence: lint, the test suites, the build,
 *   and screenshots of the screen that changed. Those go back to the app and
 *   are what somebody reads before they publish.
 *
 *   Nothing here publishes. The work lands on its own branch and stays there
 *   until an admin presses Publish in the app, which merges it to main and lets
 *   Render deploy it. A worker that could publish would be a worker that could
 *   break invoicing at 2am with nobody watching.
 *
 * SETUP (one-time):
 *   1. Claude Code installed and signed in on the subscription account — the
 *      same one the website worker uses. If that one already runs, this is done.
 *   2. A SEPARATE checkout of this repository for the worker to work in, so it
 *      is never editing files somebody has open:
 *        git clone https://github.com/ksenglish/dekker-group ../dekker-app-worker
 *      and make sure it can push:
 *        git -C ../dekker-app-worker push origin HEAD:refs/heads/worker-test
 *   3. Set these, either in the environment or in server/.env:
 *        DEKKER_API           https://dekker-group.onrender.com
 *        AUTOMATION_API_KEY   the same value as the Render env var
 *        APP_REPO_PATH        path to that checkout (optional, defaults to
 *                             ../dekker-app-worker next to this repo)
 *   4. Start it. Easiest is to double-click automation/start-app-worker.cmd,
 *      which changes to the right folder itself. From a terminal, stand in the
 *      repo root first — the paths below are relative to it:
 *        npm run worker:app
 *      (npm run from inside client/ or server/ looks in that workspace, not
 *      here, so the root is the place to be.)
 *
 * Run it alongside the website worker — they are separate processes on separate
 * queues and do not interfere. They do share one Claude subscription, so a job
 * on each at the same moment will be slower than one at a time.
 *
 * It is stateless: a job caught mid-flight is released by the server after half
 * an hour and can be queued again.
 */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// server/.env is where the key already lives, so the worker reads it rather
// than asking anyone to keep a second copy in step.
try { require('dotenv').config({ path: path.join(__dirname, '../server/.env') }); } catch { /* fine without */ }

const API = (process.env.DEKKER_API || 'https://dekker-group.onrender.com').replace(/\/$/, '');
const KEY = process.env.AUTOMATION_API_KEY || '';
const REPO = process.env.APP_REPO_PATH || path.join(__dirname, '../../dekker-app-worker');
const MAIN = process.env.APP_LIVE_BRANCH || 'main';
const POLL_MS = Number(process.env.APP_WORKER_POLL_MS || 30000);
const HEARTBEAT_MS = Number(process.env.APP_WORKER_HEARTBEAT_MS || 60000);
// Longer than the website's: this repo has a test suite to run and a build.
const JOB_TIMEOUT_MS = Number(process.env.APP_WORKER_TIMEOUT_MS || 30 * 60 * 1000);

// Deliberately narrow. The worker may edit code and commit; it may not push,
// merge, install packages or touch deployment config — pushing is done below
// with a plain git call, so Claude never needs that permission.
const ALLOWED_TOOLS = [
  'Read', 'Edit', 'Write', 'Glob', 'Grep',
  'Bash(git add *)', 'Bash(git commit *)', 'Bash(git status *)',
  'Bash(git diff *)', 'Bash(git log *)',
  'Bash(npm run lint)', 'Bash(npm run build)',
  'Bash(npx eslint *)',
].join(',');

const RULES = `You are making a change to Dekker App — the system the business runs on — on behalf of someone at the company who is not a developer.

This is not a website. Invoices, GST, timesheets, quotes and job costs all live in here, and a mistake costs real money and real trust. Prefer the smallest change that does what was asked. If the request is ambiguous in a way that could affect money, do the safe reading and say clearly in your summary which reading you took and what the other one would have been.

Work only in this repository. Make the change, satisfy yourself it is right, and commit it. Do NOT push, do NOT merge, and do NOT touch the main branch — a branch has already been made for you and pushing is handled after you finish.

Off limits entirely: render.yaml, anything under .github, the lockfiles, and server/src/db/migrations that already exist (write a NEW migration file if the change needs one — never edit one that has shipped, because it has already run on the live database).

Money is stored as integer cents excluding GST throughout. GST is 15%. If you touch anything that calculates a price, a total or a margin, say so prominently in your summary.

CHECK YOUR WORK. Run \`npm run lint\` — errors fail the deploy, warnings do not. If there are tests covering what you touched, run them. If you add behaviour worth testing, add a test for it. Do not commit anything that does not lint.

House style: New Zealand English and spelling. Match the surrounding code's style, naming and comment density. Comments explain why, not what.

When you are done, finish your reply with a short paragraph for the person who asked, in plain language, saying what you changed and what they will see on screen. No code, no file paths, no jargon. If you could not do part of it, say which part and why.`;

const log = (...a) => console.log(new Date().toLocaleTimeString('en-NZ'), ...a);

async function api(pathname, body) {
  const res = await fetch(`${API}/api/app-console${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error(`${pathname} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const git = (...args) =>
  execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim();

// Everything Claude Code committed while it was working, newest last. Read back
// from git rather than taken from anything Claude said about itself.
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
// is the combination that passes spaces and brackets through intact.
function claudeCommand(args) {
  if (process.platform !== 'win32') return { file: 'claude', argv: args };
  let resolved = 'claude';
  try {
    resolved = execFileSync('where', ['claude'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim() || 'claude';
  } catch {
    const native = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
    if (fs.existsSync(native)) resolved = native;
  }
  if (/\.exe$/i.test(resolved)) return { file: resolved, argv: args };
  return { file: process.env.COMSPEC || 'cmd.exe', argv: ['/d', '/s', '/c', resolved, ...args] };
}

// The environment Claude Code runs in, minus anything that would take it off
// the subscription. In print mode an ANTHROPIC_API_KEY in the environment is
// used ahead of the /login credential with no prompt — and this script loads
// server/.env, which is exactly where the server keeps its key. Left alone, one
// line in that file would bill every job as metered API usage.
const PAID_CREDENTIALS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
function subscriptionEnv() {
  const env = { ...process.env };
  for (const key of PAID_CREDENTIALS) delete env[key];
  env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS = env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS || '60000';
  return env;
}

// Whether Claude Code can actually sign in. An expired session makes every run
// exit in about a second with "OAuth session expired", which looks exactly like
// a change that could not be made — so the queue is left alone instead, and the
// jobs wait for somebody to sign in rather than failing one by one.
//
// Cached while it is good, re-checked every poll while it is not, so recovery is
// quick without spawning a process every thirty seconds for no reason.
const AUTH_GOOD_FOR_MS = 5 * 60 * 1000;
let authCheckedAt = 0;
let authOk = false;

function claudeAuthOk({ force = false } = {}) {
  if (!force && authOk && Date.now() - authCheckedAt < AUTH_GOOD_FOR_MS) return authOk;
  const { file, argv } = claudeCommand(['auth', 'status']);
  let out = '';
  try {
    out = execFileSync(file, argv, { encoding: 'utf8', env: subscriptionEnv(), timeout: 30000 });
  } catch (err) {
    // Signed out is itself a non-zero exit, with the answer on stdout — so the
    // throw is the normal path here, not the exceptional one.
    out = String(err.stdout || '');
  }
  let answer = null;
  try { answer = JSON.parse(out).loggedIn === true; } catch { /* no answer */ }

  if (answer !== null) {
    authOk = answer;
    authCheckedAt = Date.now();
    return authOk;
  }

  // No JSON at all: the CLI is missing, too old to have `auth status`, or the
  // spawn failed for a reason of its own. A check that cannot answer must not
  // answer "fine" — that is how a signed-out worker goes back to eating the
  // queue. Keep whatever was last known, and only assume it is fine if nothing
  // has ever said otherwise, so a missing CLI does not wedge the worker shut.
  if (!authCheckedAt) authOk = true;
  return authOk;
}

function runClaude(instruction, scratchDir) {
  const rulesFile = path.join(scratchDir, 'rules.md');
  fs.writeFileSync(rulesFile, RULES);

  // Deliberately not --bare: bare mode skips the subscription login and expects
  // an API key, which is the one thing this arrangement exists to avoid.
  const { file, argv } = claudeCommand([
    '-p', instruction,
    '--output-format', 'json',
    '--append-system-prompt-file', rulesFile,
    '--allowedTools', ALLOWED_TOOLS,
    '--permission-prompts', 'none',
    '--max-turns', '60',
    ...(process.env.APP_WORKER_MODEL ? ['--model', process.env.APP_WORKER_MODEL] : []),
  ]);

  return new Promise((resolve, reject) => {
    const child = spawn(file, argv, { cwd: REPO, env: subscriptionEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const started = Date.now();
    const ticker = setInterval(
      () => log(`  still working (${Math.round((Date.now() - started) / 60000)} min)`), 60000);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Gave up after ${Math.round(JOB_TIMEOUT_MS / 60000)} minutes`));
    }, JOB_TIMEOUT_MS);
    const done = () => { clearTimeout(timer); clearInterval(ticker); };

    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', err => { done(); reject(err); });
    child.on('close', () => {
      done();
      const raw = stdout + (stderr ? `\n--- stderr ---\n${stderr}` : '');
      try {
        const parsed = JSON.parse(stdout);
        resolve({ summary: parsed.result || parsed.text || '', raw });
      } catch {
        resolve({ summary: stdout.trim().slice(-4000), raw });
      }
    });
  });
}

// ── The checks that stand in for a preview ───────────────────────────────────
//
// Run by the worker rather than by Claude, so what the app shows is what
// actually happened rather than what the run said happened.
function check(name, command, args) {
  try {
    const out = execFileSync(command, args, { cwd: REPO, encoding: 'utf8', timeout: 10 * 60 * 1000 });
    return { name, ok: true, detail: summarise(name, out) };
  } catch (err) {
    const out = `${err.stdout || ''}${err.stderr || ''}`.trim();
    return { name, ok: false, detail: summarise(name, out) || err.message };
  }
}

function summarise(name, out) {
  const text = String(out || '');
  if (name === 'lint') {
    const m = text.match(/✖ (\d+) problems? \((\d+) errors?, (\d+) warnings?\)/);
    return m ? `${m[2]} errors, ${m[3]} warnings` : (text.trim() ? 'see the log' : 'clean');
  }
  if (name === 'build') {
    const m = text.match(/built in ([\d.]+\s*\w+)/);
    return m ? `built in ${m[1]}` : 'built';
  }
  return text.split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 200) || 'done';
}

function runChecks() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  // Lint first: it is the one the deploy itself gates on, so a failure here
  // means the change could not have shipped anyway.
  const checks = [check('lint', npm, ['run', 'lint'])];
  if (checks[0].ok) checks.push(check('build', npm, ['run', 'build']));
  return checks;
}

// Anything Claude left in the screenshots folder, as data URLs for the app.
function collectShots(scratchDir) {
  const dir = path.join(scratchDir, 'screenshots');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg)$/i.test(f))
    .slice(0, 6)
    .map(f => ({
      caption: path.basename(f, path.extname(f)).replace(/[-_]+/g, ' '),
      data_base64: `data:image/${/\.png$/i.test(f) ? 'png' : 'jpeg'};base64,`
        + fs.readFileSync(path.join(dir, f)).toString('base64'),
    }));
}

// ── One job ──────────────────────────────────────────────────────────────────

async function runJob(job) {
  log(`Job ${job.id.slice(0, 8)}: ${job.instruction.slice(0, 80)}`);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dekker-app-'));
  fs.mkdirSync(path.join(scratch, 'screenshots'), { recursive: true });

  // Start from whatever is live, on a branch of this job's own, so a change is
  // never built on top of one that was not published.
  git('fetch', 'origin', MAIN);
  git('checkout', '-B', job.branch, `origin/${MAIN}`);
  const startSha = git('rev-parse', 'HEAD');

  let summary = '', raw = '', checks = [];
  let status = 'done';
  try {
    const result = await runClaude(job.instruction, scratch);
    summary = result.summary;
    raw = result.raw;

    const commits = commitsSince(startSha);
    if (!commits.length) {
      status = 'failed';
      summary = summary || 'Nothing was changed.';
    } else {
      checks = runChecks();
      if (checks.some(c => !c.ok)) status = 'failed';
      // Pushed whatever happened to the checks: a branch that fails its checks
      // is still worth having to look at, and it cannot reach anyone until
      // somebody publishes it.
      git('push', '--force-with-lease', 'origin', `${job.branch}:${job.branch}`);
    }
  } catch (err) {
    status = 'failed';
    summary = `${summary}\n\n${err.message}`.trim();
    raw = `${raw}\n${err.stack || err.message}`;
  }

  const commits = commitsSince(startSha);
  try {
    await api(`/jobs/${job.id}/finish`, {
      status, result: summary, commits, checks,
      branch: job.branch,
      log: raw.slice(-20000),
      shots: collectShots(scratch),
    });
    log(`  ${status} — ${commits.length} commit${commits.length === 1 ? '' : 's'}, ` +
        `${checks.map(c => `${c.name} ${c.ok ? 'ok' : 'FAILED'}`).join(', ') || 'no checks'}`);
  } catch (err) {
    log(`  could not report back: ${err.message}`);
  }

  // Back to main so the checkout is never left sitting on a job's branch.
  try { git('checkout', MAIN); } catch { /* not worth failing the run over */ }
  fs.rmSync(scratch, { recursive: true, force: true });
}

// ── The loop ─────────────────────────────────────────────────────────────────

let warnedSignedOut = false;

async function tick() {
  // Checked before claiming, not after: a job taken by a worker that cannot run
  // Claude is a job marked failed for a reason nobody at the office can act on.
  if (!claudeAuthOk()) {
    if (!warnedSignedOut) {
      log('Claude Code is signed out on this machine, so nothing is being picked up.');
      log('Fix it with:  claude auth login');
      log('Jobs stay queued and will run once you are signed in.');
      warnedSignedOut = true;
    }
    await api('/jobs/heartbeat', { authed: false }).catch(() => {});
    return false;
  }
  if (warnedSignedOut) {
    log('Signed in again — back to work.');
    warnedSignedOut = false;
  }

  const { job } = await api('/jobs/claim');
  if (!job) return false;
  await runJob(job);
  return true;
}

// ── One worker per checkout ──────────────────────────────────────────────────
//
// Two workers sharing a checkout take turns checking out each other's branches
// mid-change, and the second one's window sits there looking broken while the
// first quietly does the work — which is exactly how an afternoon gets lost.
// Starting a window twice is easy to do and impossible to see, so the second
// one says so and stops.
const LOCK = path.join(REPO, '.app-worker.lock');

function holderOf(lockPath) {
  try {
    const { pid, startedAt } = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    // Signal 0 tests whether the process exists without touching it. A lock
    // left behind by a worker that crashed names a pid nobody is using, and
    // must not wedge the next one shut.
    process.kill(pid, 0);
    return { pid, startedAt };
  } catch { return null; }
}

function takeLock() {
  const held = holderOf(LOCK);
  if (held) {
    console.error('');
    console.error(`  Another app worker is already running (process ${held.pid}`
      + `${held.startedAt ? `, started ${new Date(held.startedAt).toLocaleTimeString('en-NZ')}` : ''}).`);
    console.error('  It is the one doing the work — look for its window.');
    console.error('  Close this one; two workers on one checkout get in each other\'s way.');
    console.error('');
    return false;
  }
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const release = () => { try { fs.unlinkSync(LOCK); } catch { /* already gone */ } };
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    process.on(sig, () => { release(); process.exit(0); });
  }
  return true;
}

async function main() {
  if (!KEY) {
    console.error('AUTOMATION_API_KEY is not set. See the setup notes at the top of this file.');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(REPO, '.git'))) {
    console.error(`No git checkout at ${REPO}. Clone the repo there, or set APP_REPO_PATH.`);
    process.exit(1);
  }
  if (!takeLock()) process.exit(1);
  log(`App change worker watching ${API}`);
  log(`Working in ${REPO}`);
  if (!claudeAuthOk({ force: true })) {
    log('');
    log('  Claude Code is signed out on this machine.');
    log('  Run:  claude auth login');
    log('  The worker will keep waiting and start work once you have.');
    log('');
  }

  // The liveness signal on its own, so a long job does not make the app report
  // the worker as gone mid-change.
  setInterval(() => api('/jobs/heartbeat', { authed: authOk }).catch(() => {}), HEARTBEAT_MS).unref();

  for (;;) {
    try {
      // Keep going while there is work, so a queue of three does not take an
      // extra minute and a half to get through.
      while (await tick()) { /* next */ }
    } catch (err) {
      log(`poll failed: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}

main();
