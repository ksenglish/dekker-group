import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { listen, speechSupported } from '../../lib/speech';
import {
  parseCommand, directionsUrl, startTimerFor, runningTimers,
} from '../../lib/commands';
import styles from './GlobalSearch.module.css';

// Find anything, by typing or by saying it.
//
// One box over customers, jobs, quotes, invoices and the diary. Opened with
// the button in the header or with Ctrl-K, worked with the arrow keys, and —
// the point of it — with the microphone, because somebody standing on a site
// with a phone in one hand is not going to type "JB01646".
//
// The listening is the browser's own and costs nothing to run. Where a browser
// cannot do it the button is simply not drawn.

const BADGE = {
  draft: 'badgeGrey', sent: 'badgeBlue', accepted: 'badgeGreen', declined: 'badgeRed',
  paid: 'badgeGreen', overdue: 'badgeRed',
  new: 'badgeBlue', quoted: 'badgeBlue', scheduled: 'badgeAmber',
  in_progress: 'badgeAmber', invoiced: 'badgeGreen', complete: 'badgeGreen',
  cancelled: 'badgeGrey',
};
const pretty = s => String(s || '').replace(/_/g, ' ');

export default function GlobalSearch({ open, onClose }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState([]);
  const [command, setCommand] = useState(null);
  const [rateId, setRateId] = useState('');
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [hearing, setHearing] = useState(false);
  const [micError, setMicError] = useState('');
  const inputRef = useRef(null);
  const micRef = useRef(null);
  // Set while the microphone is filling the box, so the search runs the moment
  // somebody stops talking rather than waiting for them to press something.
  const spokenRef = useRef(false);

  const flat = groups.flatMap(g => g.items.map(i => ({ ...i, group: g.label })));

  useEffect(() => {
    if (open) {
      setMicError('');
      // A frame's wait: the field does not exist to focus until it is drawn.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      micRef.current?.stop();
      setQ(''); setGroups([]); setCommand(null); setCursor(0); setHearing(false);
    }
  }, [open]);

  // The rate a timer started from here is booked at: the person's usual one,
  // same as the job page would offer. Fetched once, when the palette opens.
  useEffect(() => {
    if (!open || rateId) return;
    api.get('/settings/billing-rates')
      .then(r => setRateId(r.data?.[0]?.id || ''))
      .catch(() => {});
  }, [open, rateId]);

  // Stops listening when the palette is unmounted mid-sentence.
  useEffect(() => () => micRef.current?.stop(), []);

  // A command resolves to one offer: "Directions to JB01646". It is shown, not
  // done — pressing it is the moment anything happens.
  const resolveCommand = useCallback(async text => {
    const cmd = parseCommand(text);
    if (!cmd) return null;

    if (cmd.intent === 'myDay') {
      const { data } = await api.get('/search/my-day');
      return { ...cmd, day: data.items || [] };
    }

    // Stopping is about a timer already running on this device, so the job is
    // known without asking anybody.
    if (cmd.intent === 'stopTimer' && !cmd.target) {
      const running = runningTimers();
      if (!running.length) return { ...cmd, nothingRunning: true };
      return {
        ...cmd,
        more: running.length - 1,
        job: { id: running[0].jobId, to: `/jobs/${running[0].jobId}`, unnamed: true },
      };
    }

    // Named a job: the ordinary search finds it. Didn't: it is a question
    // about the day, so the diary answers.
    if (cmd.target) {
      const { data } = await api.get('/search', { params: { q: cmd.target } });
      const job = (data.groups || []).find(g => g.kind === 'jobs')?.items?.[0];
      const customer = (data.groups || []).find(g => g.kind === 'customers')?.items?.[0];
      if (job) return { ...cmd, job };
      // "Navigate to the Hulley place" with no job: their address will do.
      if (customer && cmd.intent === 'directions') return { ...cmd, customer };
      return { ...cmd, notFound: true };
    }

    const { data } = await api.get('/search/my-day');
    const items = data.items || [];
    if (!items.length) return { ...cmd, day: [], nothingToday: true };
    const pick = cmd.which === 'last' ? items[items.length - 1]
      : cmd.which === 'next'
        ? items.find(i => !i.start_time || i.start_time >= new Date().toTimeString().slice(0, 5)) || items[0]
        : items[0];
    return { ...cmd, job: { ...pick, id: pick.job_id, subtitle: [pick.start_time, pick.customer_name, pick.site_address].filter(Boolean).join(' · ') } };
  }, []);

  const run = useCallback(async term => {
    const text = term.trim();
    if (text.length < 2) { setGroups([]); setCommand(null); setLoading(false); return; }
    setLoading(true);
    try {
      // Both: "start the timer on the Hulley job" should offer the timer and
      // still show the job, in case it picked the wrong one.
      const [cmd, { data }] = await Promise.all([
        resolveCommand(text).catch(() => null),
        api.get('/search', { params: { q: text } }).catch(() => ({ data: {} })),
      ]);
      setCommand(cmd);
      setGroups(data.groups || []);
      setCursor(0);
    } catch {
      setGroups([]); setCommand(null);
    } finally { setLoading(false); }
  }, [resolveCommand]);

  // Typing settles before a search goes out; a spoken phrase arrives complete
  // and should not wait.
  useEffect(() => {
    if (!open) return undefined;
    if (spokenRef.current) { spokenRef.current = false; run(q); return undefined; }
    const t = setTimeout(() => run(q), 220);
    return () => clearTimeout(t);
  }, [q, open, run]);

  function go(item) {
    if (!item) return;
    onClose();
    navigate(item.to);
  }

  // What the offer says it will do, written out so nobody has to guess.
  function describe(cmd) {
    const where = cmd.job?.title || cmd.customer?.title;
    if (cmd.nothingRunning) return { text: 'No timer is running on this device.', can: false };
    if (cmd.nothingToday) return { text: 'Nothing is booked in for you today.', can: false };
    if (cmd.notFound) return { text: `Could not find “${cmd.target}”.`, can: false };
    if (cmd.intent === 'myDay') {
      return { text: cmd.day?.length ? 'Your day' : 'Nothing is booked in for you today.', can: false };
    }
    if (cmd.intent === 'directions') {
      const addr = cmd.job?.site_address || cmd.job?.subtitle || cmd.customer?.subtitle;
      return { icon: '🚗', text: `Directions to ${where}`, detail: addr, can: true, verb: 'Open maps' };
    }
    if (cmd.intent === 'startTimer') {
      return { icon: '▶', text: `Start the timer on ${where}`, detail: cmd.job?.subtitle,
        can: true, verb: 'Start it' };
    }
    if (cmd.intent === 'stopTimer') {
      return {
        icon: '■',
        text: cmd.job?.unnamed ? 'Go to the job your timer is running on' : `Stop the timer on ${where}`,
        // Said out loud, because stopping is not one press: the time wants a
        // description before it becomes a timesheet.
        detail: 'Opens the job, where the time can be described and saved.'
          + (cmd.more > 0 ? ` ${cmd.more} other timer${cmd.more === 1 ? ' is' : 's are'} also running.` : ''),
        can: true, verb: 'Go there',
      };
    }
    return { text: '', can: false };
  }

  function runCommand(cmd) {
    const job = cmd.job;
    if (cmd.intent === 'directions') {
      const address = job?.site_address
        || /·\s*([^·]+)$/.exec(job?.subtitle || cmd.customer?.subtitle || '')?.[1]?.trim();
      if (!address) return;
      onClose();
      // A new tab, so the app is still open behind the map.
      window.open(directionsUrl(address), '_blank', 'noopener');
      return;
    }
    if (cmd.intent === 'startTimer' && job) {
      startTimerFor(job.id, rateId);
      onClose();
      // Straight to the job: the timer is running and should be seen running.
      navigate(`/jobs/${job.id}`);
      return;
    }
    if (cmd.intent === 'stopTimer' && job) {
      onClose();
      navigate(`/jobs/${job.id}`);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, flat.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    // Enter takes the offer when there is one — "start the timer" then Enter,
    // without having to reach for the screen.
    if (e.key === 'Enter') {
      e.preventDefault();
      const offer = command && describe(command);
      if (offer?.can) { runCommand(command); return; }
      go(flat[cursor]);
    }
  }

  function toggleMic() {
    setMicError('');
    if (hearing) { micRef.current?.stop(); setHearing(false); return; }
    const handle = listen({
      onResult: (text, final) => {
        setQ(text);
        // The browser's final answer is the one worth searching on straight
        // away; the guesses before it only fill the box so it looks alive.
        if (final) spokenRef.current = true;
      },
      onEnd: () => setHearing(false),
      onError: msg => { setMicError(msg); setHearing(false); },
    });
    if (!handle) { setMicError('This browser will not let the app listen. Type it instead.'); return; }
    micRef.current = handle;
    setHearing(true);
    inputRef.current?.focus();
  }

  if (!open) return null;

  let index = -1;
  return (
    <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.palette} role="dialog" aria-label="Search">
        <div className={styles.inputRow}>
          <span className={styles.lens} aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            className={styles.input}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={hearing ? 'Listening…' : 'Search, or press the microphone and say it'}
            aria-label="Search customers, jobs, quotes, invoices and appointments"
          />
          {speechSupported() && (
            <button
              className={`${styles.mic} ${hearing ? styles.micOn : ''}`}
              onClick={toggleMic}
              aria-pressed={hearing}
              title={hearing ? 'Stop listening' : 'Say what you are looking for'}>
              {hearing ? '■' : '🎤'}
            </button>
          )}
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {hearing && (
          <div className={styles.hearing}>
            <span className={styles.pulse} /> Listening — say a name, a job number, or an address.
          </div>
        )}
        {micError && <div className={styles.micError}>{micError}</div>}

        <div className={styles.results}>
          {command && (() => {
            const offer = describe(command);
            if (!offer.text) return null;
            return (
              <div className={styles.action}>
                {offer.can ? (
                  <button className={styles.actionBtn} onClick={() => runCommand(command)}>
                    <span className={styles.actionIcon}>{offer.icon}</span>
                    <span className={styles.actionText}>
                      {offer.text}
                      {offer.detail && <span className={styles.actionDetail}>{offer.detail}</span>}
                    </span>
                    <span className={styles.actionVerb}>{offer.verb} ↵</span>
                  </button>
                ) : (
                  <p className={styles.actionNote}>{offer.text}</p>
                )}

                {/* "What's on today" answers itself, in order, with the next
                    thing to do at the top. */}
                {command.day?.length > 0 && command.day.map(d => (
                  <button key={d.id} className={styles.dayRow} onClick={() => go(d)}>
                    <span className={styles.dayTime}>{d.start_time || '—'}</span>
                    <span className={styles.hitTitle}>{d.title}</span>
                    <span className={styles.hitSub}>
                      {[d.customer_name, d.site_address].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                ))}
              </div>
            );
          })()}

          {q.trim().length < 2 && !hearing && (
            <p className={styles.hint}>
              Find: “Hulley”, “JB01646”, “quote 377”, or an address.
              <br />
              Ask: “navigate to my first job”, “start the timer on JB01646”, “what’s on today”.
              {speechSupported() && ' Or press 🎤 and say it.'}
            </p>
          )}
          {q.trim().length >= 2 && !loading && flat.length === 0 && !command && (
            <p className={styles.hint}>Nothing found for “{q.trim()}”.</p>
          )}
          {loading && flat.length === 0 && <p className={styles.hint}>Searching…</p>}

          {groups.map(g => (
            <div key={g.kind} className={styles.group}>
              <h3 className={styles.groupLabel}>{g.label}</h3>
              {g.items.map(item => {
                index++;
                const here = index;
                return (
                  <button
                    key={item.id}
                    className={`${styles.hit} ${here === cursor ? styles.hitOn : ''}`}
                    onMouseEnter={() => setCursor(here)}
                    onClick={() => go(item)}>
                    <span className={styles.hitTitle}>{item.title}</span>
                    {item.badge && (
                      <span className={`${styles.badge} ${styles[BADGE[item.badge] || 'badgeGrey']}`}>
                        {pretty(item.badge)}
                      </span>
                    )}
                    <span className={styles.hitSub}>{item.subtitle}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className={styles.foot}>
          <span>↑↓ to choose · ↵ to open · Esc to close</span>
        </div>
      </div>
    </div>
  );
}
