import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { isOfficeLevel } from '../../lib/permissions';
import styles from './JobPackPanel.module.css';

// The Job Form: everything a team member or subcontractor needs to work from,
// as one PDF, with the option of emailing it to them.
//
// What this screen is for is showing what is going to be in it *before* it
// goes. The office was assembling the same thing by hand out of four separate
// emails, and the failure was never the writing — it was a photo left off or a
// day in the diary nobody mentioned. So the counts are on screen: whether a
// quote has been accepted, how many days are booked, how many files come with
// it. If something reads as zero here, it is missing on the job, and that is
// worth knowing before a subbie drives to the wrong address.

const dayName = iso => {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  // Built in UTC from the parts so a calendar day is never nudged into the day
  // before by the browser's zone.
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-NZ', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
};

const when = b => {
  if (!b.start_time && !b.end_time) return 'time not set';
  if (!b.end_time) return `from ${b.start_time}`;
  if (!b.start_time) return `until ${b.end_time}`;
  return `${b.start_time}–${b.end_time}`;
};

const sentAgo = iso => new Date(iso).toLocaleString('en-NZ', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

export default function JobPackPanel({ jobId, user, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [works, setWorks] = useState(false);
  const [busy, setBusy] = useState('');
  const [pick, setPick] = useState('');        // 'team:<id>' | 'sub:<id>' | 'other'
  const [other, setOther] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState('');

  useEffect(() => {
    api.get(`/jobs/${jobId}/job-form`)
      .then(r => setData(r.data))
      .catch(err => setError(err.response?.data?.error || 'Could not load this job'))
      .finally(() => setLoading(false));
  }, [jobId]);

  const canEmail = isOfficeLevel(user?.role);

  // Who the picker is pointing at, as an address and a name.
  function chosen() {
    if (!data) return null;
    if (pick === 'other') return { to: other.trim(), name: '' };
    const [kind, id] = pick.split(':');
    if (kind === 'team') {
      const u = data.recipients.team.find(t => t.id === id);
      return u ? { to: u.email, name: u.name } : null;
    }
    if (kind === 'sub') {
      const sc = data.recipients.subcontractors.find(t => t.id === id);
      return sc ? { to: sc.email, name: sc.contact_name || sc.name } : null;
    }
    return null;
  }

  async function download() {
    setBusy('download');
    setError('');
    try {
      const r = await api.get(`/jobs/${jobId}/job-form/pdf`, {
        params: works ? { works: 1 } : {},
        responseType: 'blob',
      });
      const match = /filename="?([^"]+)"?/.exec(r.headers['content-disposition'] || '');
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = match ? match[1] : 'Job Form.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not produce the PDF. Please try again.');
    } finally { setBusy(''); }
  }

  async function send() {
    const target = chosen();
    if (!target?.to) {
      setError('Choose who it should go to first.');
      return;
    }
    setBusy('send');
    setError('');
    setSent('');
    try {
      const r = await api.post(`/jobs/${jobId}/job-form/email`, {
        to: target.to, name: target.name, message: message.trim(), works,
      });
      setSent(r.data.message || `Sent to ${target.to}`);
      setMessage('');
      setData(d => (d ? { ...d, last_sent: { recipient: target.to, sent_at: new Date().toISOString() } } : d));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send the job form');
    } finally { setBusy(''); }
  }

  const target = chosen();

  return (
    <div className={styles.overlay}>
      <div className={styles.bar}>
        <div className={styles.barTitle}>Job Form</div>
        <button type="button" className={styles.barBtn} onClick={onClose}>Close</button>
      </div>

      <div className={styles.scroll}>
        <div className={styles.sheet}>
          {loading && <div className={styles.muted}>Loading…</div>}

          {!loading && data && (
            <>
              <div className={styles.head}>
                <div className={styles.title}>
                  {[data.job.ref, data.job.customer_name].filter(Boolean).join(' · ')}
                </div>
                {data.job.site_address && (
                  <div className={styles.sub}>{data.job.site_address}</div>
                )}
              </div>

              <p className={styles.intro}>
                One PDF with the customer and site details, the agreed scope off the
                accepted quote, who is booked on which day, and every photo, plan and
                PDF held on this job’s Pre-Install Forms tab. Prices, the quote number
                and the terms of sale are deliberately left out.
              </p>

              {/* ── What's going in it ── */}
              <h3 className={styles.sectionTitle}>What is in it</h3>
              <ul className={styles.checks}>
                <li className={data.has_accepted_quote ? styles.ok : styles.warn}>
                  {data.has_accepted_quote ? (
                    <>
                      Scope from the quote accepted
                      {data.accepted_name ? ` by ${data.accepted_name}` : ''}
                      {!data.has_scope_text && ' — but that quote has no written description on it'}
                    </>
                  ) : 'No quote on this job has been accepted, so there is no agreed scope to copy in'}
                </li>
                <li className={data.booking_count ? styles.ok : styles.warn}>
                  {data.booking_count
                    ? `${data.booking_count} booking${data.booking_count === 1 ? '' : 's'} across ${data.schedule_days.length} day${data.schedule_days.length === 1 ? '' : 's'} in the diary`
                    : 'Nobody is booked on this job yet — the form will say so'}
                </li>
                <li className={data.attachments.length ? styles.ok : styles.warn}>
                  {data.attachments.length
                    ? `${data.attachments.filter(a => a.kind === 'image').length} photo/plan page${data.attachments.filter(a => a.kind === 'image').length === 1 ? '' : 's'} and ${data.attachments.filter(a => a.kind === 'pdf').length} PDF${data.attachments.filter(a => a.kind === 'pdf').length === 1 ? '' : 's'} merged in behind`
                    : 'Nothing on the Pre-Install Forms tab, so no photos or plans are attached'}
                </li>
              </ul>

              {data.accepted_count > 1 && (
                <p className={styles.notice}>
                  {data.accepted_count} quotes on this job have been accepted. The form
                  carries the most recently accepted one.
                </p>
              )}

              {/* ── The diary, as it will print ── */}
              {data.schedule_days.length > 0 && (
                <>
                  <h3 className={styles.sectionTitle}>Scheduled in the diary</h3>
                  <div className={styles.days}>
                    {data.schedule_days.map(day => (
                      <div key={day.date} className={styles.day}>
                        <div className={styles.dayName}>{dayName(day.date)}</div>
                        <div className={styles.dayPeople}>
                          {day.people.map((b, i) => (
                            <div key={i} className={styles.booking}>
                              <span className={styles.bookingTime}>{when(b)}</span>
                              <span className={styles.bookingWho}>{b.person}</span>
                              {b.appointment_type && b.appointment_type !== 'operations' && (
                                <span className={styles.tag}>{b.appointment_type}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ── The files ── */}
              {data.attachments.length > 0 && (
                <>
                  <h3 className={styles.sectionTitle}>Files attached behind it</h3>
                  <ul className={styles.files}>
                    {data.attachments.map(a => (
                      <li key={a.id}>
                        <span className={styles.fileName}>{a.filename}</span>
                        <span className={styles.fileKind}>
                          {a.is_drawing ? 'Drawing' : a.kind === 'pdf' ? 'PDF' : 'Photo'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {/* ── The one decision worth making ── */}
              <h3 className={styles.sectionTitle}>Options</h3>
              <label className={data.works_count ? styles.toggle : styles.toggleOff}>
                {/* Nothing to list means nothing to tick: an option that would
                    change nothing is worse than no option at all. */}
                <input
                  type="checkbox" checked={works} disabled={!data.works_count}
                  onChange={e => setWorks(e.target.checked)}
                />
                <span>
                  <strong>Include the works list</strong>
                  <em>
                    {data.works_count
                      ? `The ${data.works_count} line${data.works_count === 1 ? '' : 's'} off the accepted quote — descriptions and quantities only, never prices.`
                      : 'The accepted quote has no lines on it to list.'}
                  </em>
                </span>
              </label>

              {/* ── Out the door ── */}
              <h3 className={styles.sectionTitle}>Send or download</h3>

              {canEmail ? (
                <div className={styles.sendBox}>
                  <label className={styles.field}>
                    <span>Email it to</span>
                    <select value={pick} onChange={e => { setPick(e.target.value); setSent(''); }}>
                      <option value="">Choose someone…</option>
                      {data.recipients.team.length > 0 && (
                        <optgroup label="Team">
                          {data.recipients.team.map(t => (
                            <option key={t.id} value={`team:${t.id}`}>{t.name}</option>
                          ))}
                        </optgroup>
                      )}
                      {data.recipients.subcontractors.length > 0 && (
                        <optgroup label="Subcontractors">
                          {data.recipients.subcontractors.map(t => (
                            <option key={t.id} value={`sub:${t.id}`}>
                              {t.name}{t.trade ? ` — ${t.trade}` : ''}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <option value="other">Someone else…</option>
                    </select>
                  </label>

                  {pick === 'other' && (
                    <label className={styles.field}>
                      <span>Email address</span>
                      <input
                        type="email" value={other} inputMode="email" autoComplete="off"
                        placeholder="name@example.co.nz"
                        onChange={e => setOther(e.target.value)}
                      />
                    </label>
                  )}

                  {target?.to && pick !== 'other' && (
                    <div className={styles.toLine}>Goes to {target.to}</div>
                  )}

                  <label className={styles.field}>
                    <span>Anything to say with it (optional)</span>
                    <textarea
                      rows={3} value={message} onChange={e => setMessage(e.target.value)}
                      placeholder="Gate code is 4821. Park on the street — driveway is wet concrete."
                    />
                  </label>

                  <div className={styles.actions}>
                    <button
                      type="button" className={styles.primary}
                      disabled={busy !== '' || !target?.to} onClick={send}
                    >
                      {busy === 'send' ? 'Sending…' : 'Send the job form'}
                    </button>
                    <button
                      type="button" className={styles.secondary}
                      disabled={busy !== ''} onClick={download}
                    >
                      {busy === 'download' ? 'Building…' : 'Download PDF'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.sendBox}>
                  <p className={styles.muted}>
                    Emailing this out is an office job. You can still download it and
                    send it yourself.
                  </p>
                  <div className={styles.actions}>
                    <button
                      type="button" className={styles.primary}
                      disabled={busy !== ''} onClick={download}
                    >
                      {busy === 'download' ? 'Building…' : 'Download PDF'}
                    </button>
                  </div>
                </div>
              )}

              {sent && <div className={styles.sent}>{sent}</div>}
              {data.last_sent && !sent && (
                <div className={styles.lastSent}>
                  Last sent to {data.last_sent.recipient} on {sentAgo(data.last_sent.sent_at)}
                </div>
              )}
            </>
          )}

          {error && <div className={styles.error}>{error}</div>}
        </div>
      </div>
    </div>
  );
}
