import { useState, useEffect } from 'react';
import { Letterhead, Scope } from './ServiceReportView';
import styles from './ServiceReport.module.css';
import own from './JobFormView.module.css';

// The job form itself, drawn the same way whether the office is looking at it
// on the job or a subcontractor is looking at it on a link. One component, so
// the two cannot drift apart and nobody can be sent a page the office never
// saw.
//
// Laid out like the job service report — the same letterhead off the job's own
// document theme, the same three-column block of customer, job and who it is
// for, the same scope of works. Where the service report has labour, materials
// and totals, this has the job's pre-install photos and plans, then the days
// and times the diary has somebody booked.
//
// There is no money on it anywhere. That is enforced on the server, where the
// queries behind this never ask for a price.

const fmtFullDate = d => (d
  ? new Date(String(d).length <= 10 ? `${d}T12:00:00` : d)
    .toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  : '');

const fmtDay = iso => {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  // Built in UTC from the parts, so a calendar day is never nudged into the
  // day before by the reader's zone.
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-NZ', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
};

const times = b => {
  if (!b.start_time && !b.end_time) return 'Time not set';
  if (!b.end_time) return `from ${b.start_time}`;
  if (!b.start_time) return `until ${b.end_time}`;
  return `${b.start_time} – ${b.end_time}`;
};

const fileSize = bytes => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// A photo or plan. The bytes come from an endpoint that needs either a login
// or a share token, so they are fetched as a blob rather than pointed at from
// an <img src> — `loadFile` is whichever of those two this page has.
function FileTile({ file, loadFile }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (file.kind !== 'image' || !loadFile) return undefined;
    let objectUrl;
    let live = true;
    // The id, not the whole row: the public page reloads the report every
    // couple of minutes, and a new object each time would re-download every
    // photo on a page somebody has open in a van.
    loadFile(file.id)
      .then(blob => {
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.id, file.kind, loadFile]);

  const meta = [file.is_drawing ? 'Drawing' : file.kind === 'pdf' ? 'PDF' : 'Photo',
    fileSize(file.size_bytes)].filter(Boolean).join(' · ');

  if (file.kind === 'pdf') {
    return (
      <div className={own.tile}>
        <div className={own.pdfBox}>
          <span className={own.pdfMark}>PDF</span>
          <span className={own.pdfNote}>Included in full at the back of the PDF copy</span>
        </div>
        <div className={own.tileName}>{file.filename}</div>
        <div className={own.tileMeta}>{meta}</div>
      </div>
    );
  }

  return (
    <div className={own.tile}>
      {url ? (
        // Opens full size in its own tab: the one on the page is capped so a
        // portrait photo does not fill the screen on its own.
        <a href={url} target="_blank" rel="noreferrer" className={own.imgLink}>
          <img src={url} alt={file.filename} className={own.img} />
        </a>
      ) : (
        <div className={own.imgPlaceholder}>
          {failed ? 'This file could not be opened' : 'Loading…'}
        </div>
      )}
      <div className={own.tileName}>{file.filename}</div>
      <div className={own.tileMeta}>{meta}</div>
    </div>
  );
}

export default function JobFormView({ report, loadFile, heading = 'Job Form' }) {
  const { job, customer, company, quote, works, files, schedule } = report;

  return (
    <div className={styles.report}>
      <Letterhead company={company} />

      <div className={styles.titleRow}>
        <div className={styles.docType}>{heading}</div>
        <div className={styles.jobNumber}>{job.number || ''}</div>
      </div>

      {/* Customer / Job / Prepared for — the same three columns a quote and a
          service report carry. */}
      <div className={styles.detailGrid}>
        <div>
          <div className={styles.custName}>{customer.company || customer.name}</div>
          {customer.company && customer.name && <div className={styles.custLine}>{customer.name}</div>}
          {customer.contact_name && customer.contact_name !== customer.name && (
            <div className={styles.custLine}>Attn: {customer.contact_name}</div>
          )}
          {customer.address && <div className={styles.custLine}>{customer.address}</div>}
          {customer.email && <div className={styles.custLine}>{customer.email}</div>}
          {customer.phone && <div className={styles.custLine}>{customer.phone}</div>}
        </div>
        <div>
          {job.number && (
            <div className={styles.field}>
              <div className={styles.fieldLabel}>Job Number</div>
              <div className={styles.fieldValue}>{job.number}</div>
            </div>
          )}
          {job.address && (
            <div className={styles.field}>
              <div className={styles.fieldLabel}>Job Address</div>
              <div className={styles.fieldValue}>{job.address}</div>
            </div>
          )}
          {job.contact && (
            <div className={styles.field}>
              <div className={styles.fieldLabel}>Site Contact</div>
              <div className={styles.fieldValue}>
                {[job.contact, job.contact_phone].filter(Boolean).join(' · ')}
              </div>
            </div>
          )}
        </div>
        <div>
          {report.prepared_for && (
            <div className={styles.field}>
              <div className={styles.fieldLabel}>Prepared For</div>
              <div className={styles.fieldValue}>{report.prepared_for}</div>
            </div>
          )}
          <div className={styles.field}>
            <div className={styles.fieldLabel}>Issued</div>
            <div className={styles.fieldValue}>{fmtFullDate(report.generated_at)}</div>
          </div>
          {job.lead && (
            <div className={styles.field}>
              <div className={styles.fieldLabel}>Lead</div>
              <div className={styles.fieldValue}>{job.lead}</div>
            </div>
          )}
          <div className={styles.liveTag}>Live · updates as the job changes</div>
        </div>
      </div>

      {report.message && <div className={own.message}>{report.message}</div>}

      <section className={styles.section}>
        <h2>Scope of works</h2>
        {!job.scope ? (
          <p className={styles.empty}>
            No quote on this job has been accepted and the job has no description,
            so there is no agreed scope to copy in.
          </p>
        ) : (
          <>
            <p className={own.provenance}>
              {job.scope_source === 'quote' && quote
                ? `From the quote accepted${quote.accepted_name ? ` by ${quote.accepted_name}` : ''}`
                  + `${quote.accepted_at ? ` on ${fmtFullDate(quote.accepted_at)}` : ''}.`
                : 'From the job description. No quote on this job has been accepted yet.'}
            </p>
            {quote?.accepted_count > 1 && (
              <p className={own.notice}>
                {quote.accepted_count} quotes on this job have been accepted — this is the most
                recent. Check with the office if work from an earlier one is also outstanding.
              </p>
            )}
            <Scope html={job.scope} />
            {works.length > 0 && (
              <div className={`${styles.table} ${styles.worksTable}`}>
                <div className={styles.thead}>
                  <span>Supplied and installed</span>
                  <span className={styles.num}>Qty</span>
                </div>
                {works.map((w, i) => (
                  <div key={i} className={styles.row}>
                    <span>{w.description}</span>
                    <span className={styles.num}>{w.quantity}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className={styles.section}>
        <h2>Pre-install photos and plans</h2>
        {files.length === 0 ? (
          <p className={styles.empty}>Nothing from the job’s pre-install files is on this copy.</p>
        ) : (
          <div className={own.fileGrid}>
            {files.map(f => <FileTile key={f.id} file={f} loadFile={loadFile} />)}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2>Scheduled dates and times</h2>
        {schedule.length === 0 ? (
          <p className={styles.empty}>No days from the diary are on this copy.</p>
        ) : (
          <div className={`${styles.table} ${styles.schedTable}`}>
            <div className={styles.thead}>
              <span>Team member</span><span>Date</span><span>Times</span>
            </div>
            {schedule.map(b => (
              <div key={b.id} className={styles.row}>
                <span>
                  {b.person}
                  {b.mobile && <span className={own.sub}> · {b.mobile}</span>}
                </span>
                <span>
                  {fmtDay(b.date)}
                  {b.appointment_type && b.appointment_type !== 'operations' && (
                    <span className={own.tag}>{b.appointment_type}</span>
                  )}
                </span>
                <span className={styles.times}>
                  {times(b)}
                  {b.notes && <span className={own.sub}> · {b.notes}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className={styles.footnote}>
        This form carries site and scope information only. Prices, quote references,
        terms of sale and payment terms are deliberately left out. Check with the office
        before any work outside the scope above.
      </p>
    </div>
  );
}
