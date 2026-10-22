import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { listen, speechSupported } from '../../lib/speech';
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
      setQ(''); setGroups([]); setCursor(0); setHearing(false);
    }
  }, [open]);

  // Stops listening when the palette is unmounted mid-sentence.
  useEffect(() => () => micRef.current?.stop(), []);

  const run = useCallback(async term => {
    const text = term.trim();
    if (text.length < 2) { setGroups([]); setLoading(false); return; }
    setLoading(true);
    try {
      const { data } = await api.get('/search', { params: { q: text } });
      setGroups(data.groups || []);
      setCursor(0);
    } catch {
      setGroups([]);
    } finally { setLoading(false); }
  }, []);

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

  function onKeyDown(e) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, flat.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); go(flat[cursor]); }
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
          {q.trim().length < 2 && !hearing && (
            <p className={styles.hint}>
              Try “Hulley”, “JB01646”, “quote 377”, or an address.
              {speechSupported() && ' Or press 🎤 and say it.'}
            </p>
          )}
          {q.trim().length >= 2 && !loading && flat.length === 0 && (
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
