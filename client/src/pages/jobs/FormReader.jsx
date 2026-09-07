import { useState, useEffect } from 'react';
import api from '../../lib/api';
import styles from './FormReader.module.css';

// A completed form, read rather than edited: a full-screen page laid out like
// the printed document, so someone on site can scroll through what was recorded
// without pinching at greyed-out form controls.
//
// Deliberately not the PDF in a viewer. A phone browser either downloads a PDF
// or drops it into a viewer that fights the page scroll, and the text stops
// reflowing to the screen width. This is the same content as HTML, so it wraps.

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Photos come from an authenticated endpoint, so they're fetched as blobs
// rather than pointed at directly from an <img src>.
function ReaderPhoto({ photo }) {
  const [url, setUrl] = useState(photo.inline || null);
  useEffect(() => {
    if (photo.inline || !photo.key) return;
    let objectUrl;
    api.get('/forms/photos', { params: { key: photo.key }, responseType: 'blob' })
      .then(r => { objectUrl = URL.createObjectURL(r.data); setUrl(objectUrl); })
      .catch(() => {});
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photo.key, photo.inline]);

  if (!url) return <div className={styles.photoLoading}>Loading photo…</div>;
  // Opens the full-size image in its own tab, since the one in the document is
  // capped so a portrait photo doesn't fill the screen on its own.
  return (
    <a href={url} target="_blank" rel="noreferrer" className={styles.photoLink}>
      <img src={url} alt={photo.filename || 'Photo'} className={styles.photo} />
    </a>
  );
}

// One answer, as it should read. Mirrors answerText() in the PDF builder — the
// two are meant to say the same thing about the same data.
function Answer({ field, value }) {
  const blank = value === undefined || value === null || value === '';

  if (field.type === 'photo') {
    const photos = Array.isArray(value) ? value : [];
    if (!photos.length) return <div className={styles.blank}>No photos</div>;
    return (
      <div className={styles.photoGrid}>
        {photos.map((p, i) => <ReaderPhoto key={p.key || i} photo={p} />)}
      </div>
    );
  }

  if (blank) return <div className={styles.blank}>Not answered</div>;

  if (field.type === 'checkbox') {
    return (
      <div className={value === true ? styles.answerYes : styles.answerNo}>
        {value === true ? `✓ ${field.checkboxText || 'Confirmed'}` : '✕ Not confirmed'}
      </div>
    );
  }
  if (field.type === 'yesno') {
    return <div className={value === 'Yes' ? styles.answerYes : styles.answerNo}>{value}</div>;
  }
  if (field.type === 'date') return <div className={styles.answer}>{fmtDate(value)}</div>;
  if (field.type === 'signoff') {
    return (
      <div className={styles.answer}>
        {value.name || '—'}
        {value.date && <span className={styles.signoffDate}> · {fmtDate(value.date)}</span>}
      </div>
    );
  }
  // Free text keeps the line breaks it was typed with.
  return <div className={styles.answer} style={{ whiteSpace: 'pre-wrap' }}>{String(value)}</div>;
}

export default function FormReader({ jobId, submission, job, onClose, onEdit, onDelete }) {
  const [downloading, setDownloading] = useState(false);
  const fields = submission.fields_snapshot || [];
  const answers = submission.answers || {};

  useEffect(() => {
    // The page behind must not scroll while this is up, or a swipe that misses
    // the document drags the job page around underneath it.
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  async function download() {
    setDownloading(true);
    try {
      const r = await api.get(`/jobs/${jobId}/forms/${submission.id}/pdf`, { responseType: 'blob' });
      // The filename the server chose is in the header; fall back to the form name.
      const match = /filename="?([^"]+)"?/.exec(r.headers['content-disposition'] || '');
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = match ? match[1] : `${submission.name || 'Form'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert('Could not produce the PDF. Please try again.');
    } finally { setDownloading(false); }
  }

  const jobRef = job?.external_ref
    || (job?.job_number != null ? `JB${String(job.job_number).padStart(5, '0')}` : '');

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={submission.name}>
      <div className={styles.bar}>
        <button type="button" className={styles.barBtn} onClick={onClose} aria-label="Close">
          ‹ Back
        </button>
        <div className={styles.barActions}>
          <button type="button" className={styles.barBtn} onClick={download} disabled={downloading}>
            {downloading ? 'Preparing…' : '⬇ Download'}
          </button>
          {onEdit && (
            <button type="button" className={styles.barBtn} onClick={onEdit}>Reopen</button>
          )}
          {onDelete && (
            <button type="button" className={styles.barBtnDanger} onClick={onDelete}>Delete</button>
          )}
        </div>
      </div>

      {/* The scrolling document. Sized like a sheet of paper on a desktop and
          edge to edge on a phone. */}
      <div className={styles.scroll}>
        <div className={styles.sheet}>
          <header className={styles.docHeader}>
            <h1 className={styles.docTitle}>{submission.name}</h1>
            <div className={styles.docMeta}>
              {[jobRef && `Job ${jobRef}`, job?.customer_name, job?.site_address]
                .filter(Boolean).join('  ·  ')}
            </div>
            <div className={submission.status === 'completed' ? styles.docStatus : styles.docStatusOpen}>
              {submission.status === 'completed'
                ? `Completed${submission.completed_by_name ? ` by ${submission.completed_by_name}` : ''}` +
                  `${submission.completed_at ? ` on ${fmtDate(submission.completed_at)}` : ''}`
                : 'In progress — not yet completed'}
            </div>
          </header>

          {fields.length === 0 && <p className={styles.blank}>This form has no fields.</p>}

          {fields.map(f => f.type === 'section' ? (
            <div key={f.id} className={styles.section}>
              <h2>{f.label}</h2>
              {f.help && <p>{f.help}</p>}
            </div>
          ) : (
            <div key={f.id} className={styles.row}>
              <div className={styles.rowLabel}>{f.label}</div>
              <Answer field={f} value={answers[f.id]} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
