import { useState, useEffect, useRef } from 'react';
import { Letterhead } from './ServiceReportView';
import styles from './ServiceReport.module.css';
import own from './WorkProgrammeView.module.css';

// The work programme itself, drawn the same way whether the office is looking at it
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
  // Held in a ref rather than listed as a dependency. A parent that passes an
  // inline arrow hands over a new function on every render, which would tear
  // the fetch down and start it again for ever — the tile sits on "Loading…"
  // and the photo never arrives. The file is what decides when to fetch; how
  // to fetch it is not.
  const fetcher = useRef(loadFile);
  fetcher.current = loadFile;

  useEffect(() => {
    if (file.kind !== 'image' || !fetcher.current) return undefined;
    let objectUrl;
    let live = true;
    setUrl(null);
    setFailed(false);
    // The id, not the whole row: the public page reloads the report every
    // couple of minutes, and a new object each time would re-download every
    // photo on a page somebody has open in a van.
    fetcher.current(file.id)
      .then(blob => {
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.id, file.kind]);

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

// One block of the scope of works — a paragraph, a bullet, a list item — drawn
// from the runs the server parsed out of the quote's rich text. The same
// structure the PDF prints from, so bold stays bold and a bullet stays a
// bullet on both.
//
// `lift` is this person's own work; `dim` is somebody else's, kept on the page
// so they can see what is going on around them without mistaking it for theirs.
function ScopeBlock({ block, dim, lift }) {
  const cls = [own.block, dim ? own.blockDim : '', lift ? own.blockMine : '']
    .filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {block.bullet && <span className={own.bullet}>{block.bullet}</span>}
      <span style={block.align && block.align !== 'left' ? { display: 'block', textAlign: block.align } : undefined}>
        {(block.runs || []).map((run, i) => (
          <span
            key={i}
            style={{
              // Bold comes from the markup, except on a block that is this
              // person's, where the whole thing is bold by definition.
              fontWeight: lift || run.bold ? 700 : undefined,
              fontStyle: run.italic ? 'italic' : undefined,
              textDecoration: run.underline ? 'underline' : undefined,
              // A colour chosen in the editor would fight the grey that says
              // "not yours", so it is dropped on a dimmed block.
              color: dim ? undefined : run.color || undefined,
              fontSize: run.fontSize ? `${run.fontSize}px` : undefined,
            }}
          >{run.text}</span>
        ))}
      </span>
    </div>
  );
}

export default function WorkProgrammeView({ report, loadFile, heading = 'Work Programme' }) {
  const { job, customer, company, quote, works, files, schedule } = report;
  const blocks = job.scope_blocks || [];
  // Nothing marked means the whole job is theirs, and then nothing is dimmed
  // and there is no key to explain.
  const hasOwn = !!report.has_own;

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
        {!job.has_scope ? (
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
            {hasOwn && blocks.some(b => !b.own) && (
              <p className={own.key}>
                The lines in <strong>bold</strong> are yours. The rest of the scope is on
                this job but is somebody else’s — it is here so you know what else is
                happening around you.
              </p>
            )}
            {hasOwn && report.rest_mode === 'hide' && !blocks.some(b => !b.own) && (
              <p className={own.key}>
                This is your part of the scope. Other trades are on this job as well — ask
                the office if you need to know what they are doing.
              </p>
            )}
            {blocks.length === 0
              ? <p className={styles.empty}>Nothing in the scope of works is marked as yours.</p>
              : <div className={own.scope}>{blocks.map(b => (
                <ScopeBlock key={b.key} block={b} dim={hasOwn && !b.own} lift={hasOwn && b.own} />
              ))}</div>}
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
          <>
          {hasOwn && schedule.some(b => !b.own) && (
            <p className={own.key}>
              The days in <strong>bold</strong> are yours. The rest are other people on
              this job, so you know who else will be on site.
            </p>
          )}
          <div className={`${styles.table} ${styles.schedTable}`}>
            <div className={styles.thead}>
              <span>Team member</span><span>Date</span><span>Times</span>
            </div>
            {schedule.map(b => {
              // Somebody else's day is greyed and not bold. The reader's own
              // is the only thing on the row they have to act on.
              const mine = !hasOwn || b.own;
              return (
                <div key={b.id} className={mine ? styles.row : `${styles.row} ${own.dimRow}`}>
                  <span className={mine && hasOwn ? own.mine : undefined}>
                    {b.person}
                    {b.mobile && <span className={own.sub}> · {b.mobile}</span>}
                  </span>
                  <span className={mine && hasOwn ? own.mine : undefined}>
                    {fmtDay(b.date)}
                    {b.appointment_type && b.appointment_type !== 'operations' && (
                      <span className={own.tag}>{b.appointment_type}</span>
                    )}
                  </span>
                  {/* The times on their own row read as dark as the rest of
                      it: a bold name beside a grey time is a mixed signal. */}
                  <span className={mine && hasOwn
                    ? `${styles.times} ${own.mineTime}` : styles.times}>
                    {times(b)}
                    {b.notes && <span className={own.sub}> · {b.notes}</span>}
                  </span>
                </div>
              );
            })}
          </div>
          </>
        )}
      </section>

      <p className={styles.footnote}>
        This programme carries site and scope information only. Prices, quote references,
        terms of sale and payment terms are deliberately left out. Check with the office
        before any work outside the scope above.
      </p>
    </div>
  );
}
