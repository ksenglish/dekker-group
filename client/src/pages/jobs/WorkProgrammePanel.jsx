import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../lib/api';
import { isOfficeLevel } from '../../lib/permissions';
import WorkProgrammeView from './WorkProgrammeView';
import sheet from './ServiceReport.module.css';
import styles from './WorkProgrammePanel.module.css';

// The office's side of the Work Programme.
//
// One job, many copies: the sparky does not need the plumber's day in the
// diary and the roofer does not need photos of the switchboard, so each
// recipient gets their own link with their own choice of pre-install files and
// their own choice of bookings. The sheet below the controls is the same
// component the recipient opens, redrawn as boxes are ticked, so what is sent
// is what the office looked at.
//
// The link is live. Editing a copy changes what that person sees next time
// they open it rather than producing a second link competing with the first —
// which also means a day added to the diary has to be ticked on, deliberately,
// rather than appearing on a programme somebody already walked onto site with.

const fmtWhen = iso => (iso
  ? new Date(iso).toLocaleString('en-NZ', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
  : '');

const fmtDay = iso => {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-NZ', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
};

const times = b => {
  if (!b.start_time && !b.end_time) return 'time not set';
  if (!b.end_time) return `from ${b.start_time}`;
  if (!b.start_time) return `until ${b.end_time}`;
  return `${b.start_time}–${b.end_time}`;
};

const fileSize = bytes => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// A share's stored selection, as the editor holds it. Null on the row means
// everything, which is what a copy made before anybody chose gets.
const idsFor = (stored, all) =>
  (Array.isArray(stored) ? stored.map(String) : all.map(i => String(i.id)));

// A new copy starts as the whole job, theirs. Narrowing it down is a decision
// somebody makes; starting from nothing would mean every copy had to be built
// from scratch before it said anything at all.
const blankDraft = picker => ({
  id: null,
  recipient_name: '',
  recipient_email: '',
  message: '',
  include_works: false,
  rest_mode: 'grey',
  attachment_ids: picker.files.map(f => String(f.id)),
  own_schedule_ids: picker.schedule.map(b => String(b.id)),
  own_scope_keys: (picker.job.scope_blocks || []).map(b => b.key),
});

// Blocks a share is marked against that are no longer in the scope. The quote
// was edited after the copy was made, and those lines are gone — worth saying
// out loud, because the office's alternative is noticing that somebody's part
// quietly shrank.
function strayKeys(draft, picker) {
  if (!draft) return [];
  const live = new Set((picker.job.scope_blocks || []).map(b => b.key));
  return draft.own_scope_keys.filter(k => !live.has(k));
}

export default function WorkProgrammePanel({ jobId, user, onClose }) {
  const [picker, setPicker] = useState(null);
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [draft, setDraft] = useState(null);     // null = not composing
  const [sent, setSent] = useState('');
  const [copied, setCopied] = useState(null);
  const [pick, setPick] = useState('');         // the recipient dropdown

  const canShare = isOfficeLevel(user?.role);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/jobs/${jobId}/work-programme`);
      setPicker(data);
      setShares(data.shares || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load this job');
    } finally { setLoading(false); }
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  // Photos come from an endpoint that needs the login, so they are fetched as
  // blobs rather than pointed at from an <img src>.
  const loadFile = useCallback(async fileId => {
    const res = await api.get(`/jobs/${jobId}/attachments/${fileId}/data`, { responseType: 'blob' });
    return res.data;
  }, [jobId]);

  // What the sheet below shows: the whole job until somebody starts composing,
  // then that person's copy as it is being built.
  const shown = useMemo(() => {
    if (!picker) return null;
    if (!draft) return { ...picker, prepared_for: '', message: '', has_own: false };
    const files = new Set(draft.attachment_ids);
    const bookings = new Set(draft.own_schedule_ids);
    const scope = new Set(draft.own_scope_keys);
    // The same rule the server applies when it builds this person's copy for
    // real: mark what is theirs, then drop the rest when the share says to.
    // Two rules would disagree and the office would be approving a page that
    // is not the one sent.
    const mark = (items, mine, idOf) => {
      const marked = items.map(i => ({ ...i, own: mine.has(String(idOf(i))) }));
      return draft.rest_mode === 'hide' ? marked.filter(i => i.own) : marked;
    };
    return {
      ...picker,
      job: { ...picker.job, scope_blocks: mark(picker.job.scope_blocks || [], scope, b => b.key) },
      works: draft.include_works ? picker.works : [],
      files: picker.files.filter(f => files.has(String(f.id))),
      schedule: mark(picker.schedule, bookings, b => b.id),
      rest_mode: draft.rest_mode,
      has_own: true,
      prepared_for: draft.recipient_name || draft.recipient_email || '',
      message: draft.message,
    };
  }, [picker, draft]);

  function startNew() {
    setSent('');
    setError('');
    setPick('');
    setDraft(blankDraft(picker));
  }

  function editShare(share) {
    setSent('');
    setError('');
    setPick('');
    setDraft({
      id: share.id,
      recipient_name: share.recipient_name,
      recipient_email: share.recipient_email,
      message: share.message,
      include_works: share.include_works,
      rest_mode: share.rest_mode || 'grey',
      attachment_ids: idsFor(share.attachment_ids, picker.files),
      own_schedule_ids: idsFor(share.own_schedule_ids, picker.schedule),
      own_scope_keys: Array.isArray(share.own_scope_keys)
        ? share.own_scope_keys.map(String)
        : (picker.job.scope_blocks || []).map(b => b.key),
    });
  }

  const set = (key, value) => setDraft(d => ({ ...d, [key]: value }));

  function toggle(key, id) {
    setDraft(d => {
      const has = d[key].includes(String(id));
      return {
        ...d,
        [key]: has ? d[key].filter(x => x !== String(id)) : [...d[key], String(id)],
      };
    });
  }

  function choosePerson(value) {
    setPick(value);
    if (!value || value === 'other') {
      if (value === 'other') set('recipient_email', '');
      return;
    }
    const [kind, id] = value.split(':');
    const who = kind === 'team'
      ? picker.recipients.team.find(t => t.id === id)
      : picker.recipients.subcontractors.find(t => t.id === id);
    if (!who) return;
    setDraft(d => ({
      ...d,
      recipient_name: kind === 'team' ? who.name : (who.contact_name || who.name),
      recipient_email: who.email,
    }));
  }

  async function saveDraft() {
    setBusy('save');
    setError('');
    try {
      const body = {
        recipient_name: draft.recipient_name.trim(),
        recipient_email: draft.recipient_email.trim(),
        message: draft.message.trim(),
        include_works: draft.include_works,
        rest_mode: draft.rest_mode,
        attachment_ids: draft.attachment_ids,
        own_schedule_ids: draft.own_schedule_ids,
        own_scope_keys: draft.own_scope_keys,
      };
      const { data } = draft.id
        ? await api.put(`/jobs/${jobId}/work-programme/shares/${draft.id}`, body)
        : await api.post(`/jobs/${jobId}/work-programme/shares`, body);
      setShares(list => (draft.id
        ? list.map(s => (s.id === data.id ? data : s))
        : [data, ...list]));
      setDraft(d => ({ ...d, id: data.id }));
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save that copy');
      return null;
    } finally { setBusy(''); }
  }

  async function sendDraft() {
    if (!draft.recipient_email.trim()) {
      setError('Who is it going to? Choose someone, or type an address.');
      return;
    }
    // Saved first, always: the link in the email has to point at what is on
    // screen, not at whatever was stored before the last few boxes were ticked.
    const share = await saveDraft();
    if (!share) return;
    setBusy('send');
    try {
      const { data } = await api.post(`/jobs/${jobId}/work-programme/shares/${share.id}/email`,
        { to: draft.recipient_email.trim() });
      setSent(data.message);
      setShares(list => list.map(s => (s.id === share.id
        ? { ...s, sent_at: new Date().toISOString() } : s)));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send the work programme');
    } finally { setBusy(''); }
  }

  async function revoke(share) {
    const who = share.recipient_name || share.recipient_email || 'this copy';
    if (!confirm(`Stop the link for ${who}? Sharing again later gives them a new one.`)) return;
    setBusy(`revoke:${share.id}`);
    try {
      await api.delete(`/jobs/${jobId}/work-programme/shares/${share.id}`);
      setShares(list => list.filter(s => s.id !== share.id));
      if (draft?.id === share.id) setDraft(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not stop that link');
    } finally { setBusy(''); }
  }

  async function download(shareId) {
    setBusy('download');
    setError('');
    try {
      const res = await api.get(`/jobs/${jobId}/work-programme/pdf`, {
        params: shareId ? { share: shareId } : {},
        responseType: 'blob',
      });
      const match = /filename="?([^"]+)"?/.exec(res.headers['content-disposition'] || '');
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = match ? match[1] : 'Work Programme.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not produce the PDF. Please try again.');
    } finally { setBusy(''); }
  }

  function copyLink(share) {
    const url = `${window.location.origin}${share.path}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(share.id);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => {});
  }

  const allFiles = () => set('attachment_ids', picker.files.map(f => String(f.id)));
  const noFiles = () => set('attachment_ids', []);
  const allDays = () => set('own_schedule_ids', picker.schedule.map(b => String(b.id)));
  const noDays = () => set('own_schedule_ids', []);
  const allScope = () => set('own_scope_keys', (picker.job.scope_blocks || []).map(b => b.key));
  const noScope = () => set('own_scope_keys', []);
  // Everything booked for this person by name. The common case by a mile:
  // a subbie's own days, ticked in one go rather than one at a time.
  const theirDays = () => {
    const who = (draft.recipient_name || '').trim().toLowerCase();
    if (!who) return;
    set('own_schedule_ids', picker.schedule
      .filter(b => String(b.person || '').toLowerCase().includes(who)
        || who.includes(String(b.person || '').toLowerCase()))
      .map(b => String(b.id)));
  };
  const scopeBlocks = picker?.job?.scope_blocks || [];
  const stray = strayKeys(draft, picker || { job: {} });

  if (loading) {
    return (
      <div className={styles.overlay}>
        <div className={styles.bar}>
          <div className={styles.barTitle}>Work Programme</div>
          <button type="button" className={styles.barBtn} onClick={onClose}>Close</button>
        </div>
        <div className={styles.scroll}><div className={styles.muted}>Loading…</div></div>
      </div>
    );
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.bar}>
        <div className={styles.barTitle}>
          Work Programme
          {picker?.company?.theme_name && (
            <span className={styles.barTheme}>{picker.company.theme_name}</span>
          )}
        </div>
        <div className={styles.barActions}>
          <button type="button" className={styles.barBtn}
            disabled={busy !== ''} onClick={() => download(draft?.id)}>
            {busy === 'download' ? 'Building…' : '⬇ PDF'}
          </button>
          <button type="button" className={styles.barBtn} onClick={onClose}>Close</button>
        </div>
      </div>

      <div className={styles.scroll}>
        <div className={styles.inner}>
          {error && <div className={styles.error}>{error}</div>}
          {sent && <div className={styles.sent}>{sent}</div>}

          {/* ── Who has a copy ── */}
          {canShare && !draft && (
            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <h3>Who has a copy</h3>
                <button type="button" className={styles.primarySmall} onClick={startNew}>
                  + New copy for someone
                </button>
              </div>
              {shares.length === 0 ? (
                <p className={styles.muted}>
                  Nobody yet. A copy is one person’s link — their own choice of photos,
                  plans and booked days — so a subcontractor gets what they need and
                  nothing else.
                </p>
              ) : (
                <ul className={styles.shareList}>
                  {shares.map(s => (
                    <li key={s.id} className={styles.share}>
                      <div className={styles.shareWho}>
                        <strong>{s.recipient_name || s.recipient_email || 'Unnamed copy'}</strong>
                        {s.recipient_email && s.recipient_name && (
                          <span className={styles.shareMail}>{s.recipient_email}</span>
                        )}
                        <span className={styles.shareMeta}>
                          {s.sent_at ? `Sent ${fmtWhen(s.sent_at)}` : 'Not sent yet'}
                          {s.created_by_name ? ` · by ${s.created_by_name}` : ''}
                        </span>
                      </div>
                      <div className={styles.shareActions}>
                        <button type="button" className={styles.linkBtn} onClick={() => copyLink(s)}>
                          {copied === s.id ? '✓ Copied' : 'Copy link'}
                        </button>
                        <a className={styles.linkBtn} href={s.path} target="_blank" rel="noreferrer">Open</a>
                        <button type="button" className={styles.linkBtn} onClick={() => editShare(s)}>Edit</button>
                        <button type="button" className={styles.linkBtnDanger}
                          disabled={busy === `revoke:${s.id}`} onClick={() => revoke(s)}>Stop</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!canShare && (
            <div className={styles.panel}>
              <p className={styles.muted}>
                Sending this out is an office job. You can still read it here and
                download a copy from the button above.
              </p>
            </div>
          )}

          {/* ── Composing one person's copy ── */}
          {draft && (
            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <h3>{draft.id ? 'This copy' : 'A copy for someone'}</h3>
                <button type="button" className={styles.linkBtn} onClick={() => setDraft(null)}>
                  Back to the list
                </button>
              </div>

              <div className={styles.fields}>
                <label className={styles.field}>
                  <span>Who is it for</span>
                  <select value={pick} onChange={e => choosePerson(e.target.value)}>
                    <option value="">Choose someone…</option>
                    {picker.recipients.team.length > 0 && (
                      <optgroup label="Team">
                        {picker.recipients.team.map(t => (
                          <option key={t.id} value={`team:${t.id}`}>{t.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {picker.recipients.subcontractors.length > 0 && (
                      <optgroup label="Subcontractors">
                        {picker.recipients.subcontractors.map(t => (
                          <option key={t.id} value={`sub:${t.id}`}>
                            {t.name}{t.trade ? ` — ${t.trade}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <option value="other">Someone else…</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Name on the form</span>
                  <input type="text" value={draft.recipient_name}
                    onChange={e => set('recipient_name', e.target.value)}
                    placeholder="Dave" />
                </label>
                <label className={styles.field}>
                  <span>Email</span>
                  <input type="email" inputMode="email" autoComplete="off"
                    value={draft.recipient_email}
                    onChange={e => set('recipient_email', e.target.value)}
                    placeholder="name@example.co.nz" />
                </label>
              </div>

              <label className={styles.field}>
                <span>Anything to say to this person (goes on their copy and in their email)</span>
                <textarea rows={2} value={draft.message}
                  onChange={e => set('message', e.target.value)}
                  placeholder="Gate code is 4821. Park on the street — driveway is wet concrete." />
              </label>

              {/* What part of the job is theirs */}
              <div className={styles.group}>
                <div className={styles.groupHead}>
                  <h4>Their part of the scope of works</h4>
                  <div className={styles.groupTools}>
                    <span className={styles.count}>
                      {draft.own_scope_keys.length} of {scopeBlocks.length}
                    </span>
                    <button type="button" className={styles.linkBtn} onClick={allScope}>All</button>
                    <button type="button" className={styles.linkBtn} onClick={noScope}>None</button>
                  </div>
                </div>
                {scopeBlocks.length === 0 ? (
                  <p className={styles.muted}>
                    There is no scope on this job to divide up — no accepted quote and no
                    job description.
                  </p>
                ) : (
                  <ul className={styles.ticks}>
                    {scopeBlocks.map(b => (
                      <li key={b.key}>
                        <label className={styles.tick}>
                          <input type="checkbox"
                            checked={draft.own_scope_keys.includes(b.key)}
                            onChange={() => toggle('own_scope_keys', b.key)} />
                          <span>
                            <strong className={styles.scopeLine}>
                              {b.bullet ? `${b.bullet} ` : ''}{b.text}
                            </strong>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {stray.length > 0 && (
                  <p className={styles.warn}>
                    {stray.length} line{stray.length === 1 ? '' : 's'} this copy was marked
                    against {stray.length === 1 ? 'is' : 'are'} no longer in the scope — the
                    quote has been edited since. Check the ticks above before sending it again.
                  </p>
                )}
              </div>

              {/* Photos and plans */}
              <div className={styles.group}>
                <div className={styles.groupHead}>
                  <h4>Pre-install photos and plans</h4>
                  <div className={styles.groupTools}>
                    <span className={styles.count}>
                      {draft.attachment_ids.length} of {picker.files.length}
                    </span>
                    <button type="button" className={styles.linkBtn} onClick={allFiles}>All</button>
                    <button type="button" className={styles.linkBtn} onClick={noFiles}>None</button>
                  </div>
                </div>
                {picker.files.length === 0 ? (
                  <p className={styles.muted}>
                    Nothing on this job’s Pre-Install Forms tab yet.
                  </p>
                ) : (
                  <ul className={styles.ticks}>
                    {picker.files.map(f => (
                      <li key={f.id}>
                        <label className={styles.tick}>
                          <input type="checkbox"
                            checked={draft.attachment_ids.includes(String(f.id))}
                            onChange={() => toggle('attachment_ids', f.id)} />
                          <span>
                            <strong>{f.filename}</strong>
                            <em>
                              {[f.is_drawing ? 'Drawing' : f.kind === 'pdf' ? 'PDF' : 'Photo',
                                fileSize(f.size_bytes)].filter(Boolean).join(' · ')}
                            </em>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Booked days */}
              <div className={styles.group}>
                <div className={styles.groupHead}>
                  <h4>Their days on the job</h4>
                  <div className={styles.groupTools}>
                    <span className={styles.count}>
                      {draft.own_schedule_ids.length} of {picker.schedule.length}
                    </span>
                    {draft.recipient_name.trim() && (
                      <button type="button" className={styles.linkBtn} onClick={theirDays}>
                        Just theirs
                      </button>
                    )}
                    <button type="button" className={styles.linkBtn} onClick={allDays}>All</button>
                    <button type="button" className={styles.linkBtn} onClick={noDays}>None</button>
                  </div>
                </div>
                {picker.schedule.length === 0 ? (
                  <p className={styles.muted}>Nobody is booked on this job yet.</p>
                ) : (
                  <ul className={styles.ticks}>
                    {picker.schedule.map(b => (
                      <li key={b.id}>
                        <label className={styles.tick}>
                          <input type="checkbox"
                            checked={draft.own_schedule_ids.includes(String(b.id))}
                            onChange={() => toggle('own_schedule_ids', b.id)} />
                          <span>
                            <strong>{fmtDay(b.date)} · {b.person}</strong>
                            <em>
                              {times(b)}
                              {b.appointment_type && b.appointment_type !== 'operations'
                                && ` · ${b.appointment_type} diary`}
                              {b.notes ? ` · ${b.notes}` : ''}
                            </em>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* What happens to the parts that are not theirs */}
              <div className={styles.group}>
                <div className={styles.groupHead}>
                  <h4>Everything that is not theirs</h4>
                </div>
                <label className={styles.tick}>
                  <input type="radio" name="rest_mode" value="grey"
                    checked={draft.rest_mode !== 'hide'}
                    onChange={() => set('rest_mode', 'grey')} />
                  <span>
                    <strong>Grey it out</strong>
                    <em>
                      They see the whole job with their own part in bold, so they know who
                      else is on site and what is happening around them.
                    </em>
                  </span>
                </label>
                <label className={styles.tick}>
                  <input type="radio" name="rest_mode" value="hide"
                    checked={draft.rest_mode === 'hide'}
                    onChange={() => set('rest_mode', 'hide')} />
                  <span>
                    <strong>Leave it off entirely</strong>
                    <em>
                      Their copy carries only their own work and their own days. Nothing
                      about the rest of the job is sent at all.
                    </em>
                  </span>
                </label>
              </div>

              <label className={picker.works_available ? styles.tick : styles.tickOff}>
                <input type="checkbox" checked={draft.include_works}
                  disabled={!picker.works_available}
                  onChange={e => set('include_works', e.target.checked)} />
                <span>
                  <strong>Include the works list</strong>
                  <em>
                    {picker.works_available
                      ? `The ${picker.works_available} line${picker.works_available === 1 ? '' : 's'} off `
                        + 'the accepted quote — descriptions and quantities only, never prices.'
                      : 'The accepted quote has no lines on it to list.'}
                  </em>
                </span>
              </label>

              <p className={styles.footnote}>
                The link stays live: editing this copy changes what they see next time they
                open it. A photo, a day or a new line in the scope added to the job later
                has to be ticked on here — it will not appear on a programme somebody has
                already walked onto site with.
              </p>

              <div className={styles.actions}>
                <button type="button" className={styles.primary}
                  disabled={busy !== ''} onClick={sendDraft}>
                  {busy === 'send' ? 'Sending…' : 'Save and send'}
                </button>
                <button type="button" className={styles.secondary}
                  disabled={busy !== ''} onClick={saveDraft}>
                  {busy === 'save' ? 'Saving…' : draft.id ? 'Save changes' : 'Save the link'}
                </button>
                {draft.id && (
                  <button type="button" className={styles.secondary}
                    disabled={busy !== ''} onClick={() => download(draft.id)}>
                    Download this copy
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── The form itself, exactly as they will see it ── */}
          <div className={styles.sheetWrap}>
            <div className={styles.sheetLabel}>
              {draft
                ? `What ${draft.recipient_name || 'they'} will see`
                : 'The whole job — pick someone above to send a copy of part of it'}
            </div>
            <div className={sheet.publicSheet}>
              {shown && <WorkProgrammeView report={shown} loadFile={loadFile} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
