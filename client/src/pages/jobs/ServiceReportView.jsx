import styles from './ServiceReport.module.css';

// The report itself, drawn the same way whether the office is looking at it on
// the job or the customer is looking at it on a link. One component, so the two
// cannot drift apart and a customer cannot be shown a different number from the
// one the office is reading.
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

const fmtTime = t => (t
  ? new Date(t).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, '')
  : null);

const hours = h => `${(Math.round((h || 0) * 100) / 100).toFixed(2)} h`;

export default function ServiceReportView({ report, heading = 'Job Service Report' }) {
  const { job, customer, labour, materials, totals } = report;

  return (
    <div className={styles.report}>
      <div className={styles.head}>
        <div>
          <div className={styles.docType}>{heading}</div>
          <h1 className={styles.jobNumber}>{job.number || 'Job'}</h1>
          {job.address && <div className={styles.addr}>{job.address}</div>}
        </div>
        <div className={styles.headRight}>
          {customer.company || customer.name ? (
            <>
              <div className={styles.forLabel}>Prepared for</div>
              <div className={styles.forName}>{customer.company || customer.name}</div>
              {customer.company && customer.name && <div className={styles.addr}>{customer.name}</div>}
            </>
          ) : null}
          <div className={styles.liveTag}>Live · updates as work is recorded</div>
        </div>
      </div>

      {job.scope && (
        <section className={styles.section}>
          <h2>Scope of works</h2>
          <p className={styles.scope}>{job.scope}</p>
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
