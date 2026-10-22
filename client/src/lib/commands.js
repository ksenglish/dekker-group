// Asking the app to do something, rather than to find something.
//
// "Navigate to my first job", "start the timer on JB01646", "what's on today".
// These are commands, not conversation: a handful of verbs, each with one
// meaning. Matching them is a list of phrases, which costs nothing to run,
// answers instantly, and cannot decide to do something else today.
//
// Nothing here acts on its own. A command is turned into an offer the person
// confirms, because a timer writes down somebody's hours and a wrong guess at
// a job number should cost a glance, not an argument with a timesheet.

// The verbs, longest and most specific first so "stop the timer" is not read
// as "stop".
const VERBS = [
  // Getting there. A field crew saying "navigate" mean the van, not the app.
  { intent: 'directions', re: /\b(?:navigate|directions?|drive|take me|get me|how do i get)\s*(?:to|there)?\b/i },
  { intent: 'startTimer', re: /\b(?:start|begin)\s*(?:the\s*)?(?:timer|clock|time)\b|\bclock(?:ing)?\s*on\b|\bstart work(?:ing)?\b/i },
  { intent: 'stopTimer', re: /\b(?:stop|end|finish|pause)\s*(?:the\s*)?(?:timer|clock|time)\b|\bclock(?:ing)?\s*off\b|\bknock(?:ing)?\s*off\b/i },
  { intent: 'myDay', re: /\b(?:my day|what(?:'s| is) on(?: today)?|what am i doing|my (?:jobs|schedule|appointments|work)(?: for)?(?: today)?|today'?s? (?:jobs|schedule|work))\b/i },
];

// Which job, when it is not named. "My first job of the day" is the earliest
// thing booked in today; "next" is the next one still to come.
const WHICH = [
  { pick: 'first', re: /\b(?:my\s*)?(?:first|1st|earliest)\s*(?:job|one|call|appointment|stop)?\b/i },
  { pick: 'next', re: /\b(?:my\s*)?next\s*(?:job|one|call|appointment|stop)?\b/i },
  { pick: 'last', re: /\b(?:my\s*)?(?:last|final)\s*(?:job|one|call|appointment|stop)?\b/i },
];

// Words left over once the verb has been taken out that mean nothing on their
// own — what is left after these is the name of the thing being asked about.
const FILLER = /\b(?:the|a|my|to|on|for|at|of|please|job|jobs|site|today|this one|it)\b/gi;

export function parseCommand(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  const verb = VERBS.find(v => v.re.test(text));
  if (!verb) return null;

  // What is left once the verb is gone: either a job to look up, or nothing,
  // meaning "the one I am looking at" or "the one booked in".
  let rest = text.replace(verb.re, ' ');

  const which = WHICH.find(w => w.re.test(rest));
  if (which) rest = rest.replace(which.re, ' ');

  const target = rest.replace(FILLER, ' ').replace(/\s+/g, ' ').trim()
    .replace(/[.?!,]+$/, '');

  return {
    intent: verb.intent,
    // 'first' | 'next' | 'last' | null — which of today's bookings was meant.
    which: which?.pick || (verb.intent === 'myDay' ? 'all' : null),
    // What to search for, when they named something.
    target,
  };
}

// Where to send somebody who asked to be driven there. Google Maps takes an
// address and hands over to whichever app the phone actually uses.
export function directionsUrl(address) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

// Starting a timer is writing the same two keys the job page reads, so a timer
// started from here is the same timer, running on the job, with nothing new to
// keep in step.
//
// It lives in this browser and nowhere else: that is how the job page has
// always worked. A timer started on the phone cannot be stopped from the
// office computer, and saying so is better than pretending otherwise.
export function startTimerFor(jobId, billingRateId) {
  try {
    localStorage.setItem(`timer_${jobId}`, String(Date.now()));
    if (billingRateId) localStorage.setItem(`timer_rate_${jobId}`, billingRateId);
    return true;
  } catch { return false; }
}

export function timerRunningFor(jobId) {
  try { return Boolean(parseInt(localStorage.getItem(`timer_${jobId}`), 10)); } catch { return false; }
}

// Every job this browser has a timer running on. Used to answer "stop the
// timer" when nobody said which job — almost always there is exactly one.
export function runningTimers() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      // Anything but the companion "timer_rate_<job>" key, which records what
      // the time is booked at rather than a timer of its own.
      const m = /^timer_(?!rate_)(.+)$/.exec(key || '');
      if (!m) continue;
      const started = parseInt(localStorage.getItem(key), 10);
      if (started) out.push({ jobId: m[1], started });
    }
  } catch { /* storage unavailable: no timers to report */ }
  return out.sort((a, b) => a.started - b.started);
}
