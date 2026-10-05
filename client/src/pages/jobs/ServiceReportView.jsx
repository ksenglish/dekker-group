import { safeHtml, isHtml } from '../../lib/richText';
import styles from './ServiceReport.module.css';

// The report itself, drawn the same way whether the office is looking at it on
// the job or the customer is looking at it on a link. One component, so the two
// cannot drift apart and a customer cannot be shown a different number from the
// one the office is reading.
//
// The letterhead and the Bill To block follow the same theme the job's quotes
// and invoices use, so a customer who has had all three has had them from one
// company.
//
// Everything here is charge-out. Cost and margin are never part of this data.

const money = cents => {
  const n = (cents || 0) / 100;
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtDate = d => (d
  ? new Date(String(d).length <= 10 ? `${d}T12:00:00` : d)
      .toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })
  : '');

const fmtFullDate = d => (d
  ? new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  : '');

const fmtTime = t => (t
  ? new Date(t).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, '')
  : null);

const hours = h => `${(Math.round((h || 0) * 100) / 100).toFixed(2)} h`;

const LOGO_HEIGHTS = { small: 40, medium: 58, large: 76 };

// The description is rich text from the job editor on anything recent, and
// plain text on jobs that predate it. Rendering plain text as HTML would weld
// its lines together, so each is handled as what it is.
function Scope({ html }) {
  if (!html) return null;
  if (!isHtml(html)) return <p className={styles.scope}>{html}</p>;
  return <div className={styles.scope} dangerouslySetInnerHTML={{ __html: safeHtml(html) }} />;
}

function Letterhead({ company }) {
  if (!company) return null;
  const logoOnLeft = (company.logoPosition || 'left') === 'left';
  const contactOnLeft = (company.contactPosition || 'right') === 'left';
  const logoHeight = LOGO_HEIGHTS[company.logoSize] || LOGO_HEIGHTS.medium;
  const lines = (company.contactDetails || '').split('\n').map(l => l.trim()).filter(Boolean);

  const logoBlock = (
    <div key="logo" className={styles.logoBlock} style={{ order: logoOnLeft ? 1 : 2 }}>
      {company.logo
        ? <img src={company.logo} alt={company.name || 'Logo'}
            className={styles.logo} style={{ height: logoHeight, maxWidth: logoHeight * 2.8 }} />
        : <div className={styles.companyName}>{company.name}</div>}
    </div>
  );
  const contactBlock = (
    <div key="contact" className={styles.contactBlock}
      style={{ order: contactOnLeft ? 1 : 2, textAlign: contactOnLeft ? 'left' : 'right' }}>
      {lines.map((line, i) => <div key={i}>{line}</div>)}
    </div>
  );

  return <div className={styles.letterhead}>{[logoBlock, contactBlock]}</div>;
}

export default function ServiceReportView({ report, heading = 'Job Service Report' }) {
  const { job, customer, company, labour, materials, totals } = report;

  return (
    <div className={styles.report}>
      <Letterhead company={company} />

      <div className={styles.titleRow}>
        <div className={styles.docType}>{heading}</div>
        <div className={styles.jobNumber}>{job.number || ''}</div>
      </div>

      {/* Bill To / Job / Report, the same three columns a quote carries */}
      <div className={styles.detailGrid}>
        <div>
          <div className={styles.custName}>{customer.company || customer.name}</div>
          {customer.company && customer.name && <div className={styles.custLine}>{customer.name}</div>}
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
        </div>
        <div>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>Recorded To</div>
            <div className={styles.fieldValue}>{fmtFullDate(report.generated_at)}</div>
          </div>
          {company?.gstNumber && (
            <div className={styles.field}>
              <div className={styles.fieldLabel}>GST Number</div>
              <div className={styles.fieldValue}>{company.gstNumber}</div>
            </div>
          )}
          <div className={styles.liveTag}>Live · updates as work is recorded</div>
        </div>
      </div>

      {job.scope && (
        <section className={styles.section}>
          <h2>Scope of works</h2>
          <Scope html={job.scope} />
        </section>
      )}

      <section className={styles.section}>
        <h2>Labour</h2>
        {labour.length === 0 ? (
          <p className={styles.empty}>No hours recorded on this job yet.</p>
        ) : (
          <div className={styles.table}>
            <div className={styles.thead}>
              <span>Team member</span><span>Date</span><span>Times</span>
              <span className={styles.num}>Hours</span>
              <span className={styles.num}>Rate</span>
              <span className={styles.num}>Amount</span>
            </div>
            {labour.map(l => (
              <div key={l.id} className={styles.row}>
                <span>{l.user_name}</span>
                <span>{fmtDate(l.date)}</span>
                <span className={styles.times}>
                  {/* An entry imported without a clock-in says so, rather than
                      showing an invented time. */}
                  {fmtTime(l.start_time) && fmtTime(l.end_time)
                    ? `${fmtTime(l.start_time)} – ${fmtTime(l.end_time)}`
                    : <em>hours logged</em>}
                </span>
                <span className={styles.num}>{hours(l.hours)}</span>
                <span className={styles.num}>
                  {l.rate > 0 ? `$${l.rate.toFixed(2)}` : <em className={styles.noCharge}>no charge</em>}
                </span>
                <span className={styles.num}>{money(l.charge_cents)}</span>
              </div>
            ))}
            <div className={styles.subtotalRow}>
              <span className={styles.subtotalLabel}>Labour</span>
              <span className={styles.num}>{hours(totals.labour_hours)}</span>
              <span />
              <span className={styles.num}>{money(totals.labour_cents)}</span>
            </div>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2>Materials</h2>
        {materials.length === 0 ? (
          <p className={styles.empty}>No materials recorded on this job yet.</p>
        ) : (
          <div className={`${styles.table} ${styles.matTable}`}>
            <div className={styles.thead}>
              <span>Item</span><span>Supplied</span>
              <span className={styles.num}>Qty</span>
              <span className={styles.num}>Unit</span>
              <span className={styles.num}>Amount</span>
            </div>
            {materials.map(m => (
              <div key={m.id} className={`${styles.row} ${m.total_cents < 0 ? styles.credit : ''}`}>
                <span>{m.description}</span>
                <span className={styles.times}>
                  {[m.supplier, fmtDate(m.date)].filter(Boolean).join(' · ')}
                </span>
                <span className={styles.num}>{m.quantity}</span>
                <span className={styles.num}>{money(m.unit_price_cents)}</span>
                <span className={styles.num}>{money(m.total_cents)}</span>
              </div>
            ))}
            <div className={styles.subtotalRow}>
              <span className={styles.subtotalLabel}>Materials</span>
              <span />
              <span className={styles.num}>{money(totals.materials_cents)}</span>
            </div>
          </div>
        )}
      </section>

      <section className={styles.totals}>
        <div className={styles.totalLine}>
          <span>Labour</span><span>{money(totals.labour_cents)}</span>
        </div>
        <div className={styles.totalLine}>
          <span>Materials</span><span>{money(totals.materials_cents)}</span>
        </div>
        <div className={`${styles.totalLine} ${styles.subtotal}`}>
          <span>Subtotal (excl. GST)</span><span>{money(totals.subtotal_cents)}</span>
        </div>
        <div className={styles.totalLine}>
          <span>GST (15%)</span><span>{money(totals.gst_cents)}</span>
        </div>
        <div className={`${styles.totalLine} ${styles.grand}`}>
          <span>Total (incl. GST)</span><span>{money(totals.total_cents)}</span>
        </div>
      </section>

      <p className={styles.footnote}>
        This report shows the work recorded on this job to date and is not a tax invoice.
        Figures change as further hours and materials are entered.
      </p>
    </div>
  );
}
