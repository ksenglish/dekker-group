// The Job Form: one PDF a subcontractor can work from.
//
// Pages in order — who the customer is, where the site is, what the job is,
// the scope off the accepted quote, who is booked on which day, then every
// photo and plan off the job's Pre-Install Forms tab, then any PDFs attached
// there merged in whole.
//
// There is no money anywhere in it. The document says so in as many words, so
// a subbie reading it knows the figures were left out on purpose rather than
// wondering what page they fell off.
const PDFDocument = require('pdfkit');
const { PDFDocument: PdfLib } = require('pdf-lib');
const { renderDescriptionHtml, isHtml, stripDiacritics } = require('./pdf');

const TEXT = '#0f172a';
const MID_GREY = '#64748b';
const RULE = '#e2e8f0';
const SOFT = '#f8fafc';

const MARGIN = 50;
const PAGE_W = 595.28;  // A4 pt
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - MARGIN - 18;   // room for the page footer

const LABELS = {
  installation: 'Installation', service: 'Service', inspection: 'Inspection',
  repair: 'Repair', quote_only: 'Quote only',
  new: 'New', quoted: 'Quoted', scheduled: 'Scheduled', in_progress: 'In progress',
  invoiced: 'Invoiced', complete: 'Complete', cancelled: 'Cancelled',
  low: 'Low', medium: 'Medium', high: 'High',
  sales: 'Sales', operations: 'Operations',
};
const label = v => LABELS[v] || (v ? String(v).replace(/_/g, ' ') : '');

// Built from the date parts in UTC so a calendar day is never nudged into the
// day before by the server's zone. The server runs in UTC; the business does
// not, and 'YYYY-MM-DD' parsed as an instant is exactly how a Tuesday becomes
// a Monday.
function dayLabel(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return String(iso);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-NZ', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function dateLabel(value) {
  if (!value) return '';
  const iso = value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return '';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function timeRange(b) {
  if (!b.start_time && !b.end_time) return 'Time not set';
  if (!b.end_time) return `From ${b.start_time}`;
  if (!b.start_time) return `Until ${b.end_time}`;
  return `${b.start_time} – ${b.end_time}`;
}

const s = v => stripDiacritics(v == null ? '' : String(v));

function fileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function buildJobPackPDF({
  data, theme = {}, images = [], pdfs = [],
  includeWorks = false, issuedBy = '', issuedTo = '', message = '', skipped = [],
}) {
  const { job, quote, works, schedule_days: days, team, attachments } = data;
  const brand = theme.brandColour || '#1e40af';

  const mainBuf = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: 'A4', bufferPages: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = MARGIN;
    // The (y, needed) => y shape, because that is what renderDescriptionHtml
    // expects and the two must not disagree about where the page ends.
    const ensureSpace = (yy, needed) => {
      if (yy + needed > BOTTOM) { doc.addPage(); return MARGIN; }
      return yy;
    };
    const space = needed => { y = ensureSpace(y, needed); };

    function section(title) {
      space(30);
      doc.rect(MARGIN, y, CONTENT_W, 20).fill(brand);
      doc.fillColor('white').fontSize(9.5).font('Helvetica-Bold')
        .text(s(title).toUpperCase(), MARGIN + 8, y + 5.5,
          { width: CONTENT_W - 16, lineBreak: false, ellipsis: true });
      doc.fillColor(TEXT);
      y += 28;
    }

    // One label-above-value field, over a given width.
    function fieldAt(x, width, name, value) {
      const valueText = s(value) || '—';
      doc.fontSize(7.5).font('Helvetica-Bold');
      const labelH = doc.heightOfString(s(name), { width });
      doc.fontSize(10).font('Helvetica');
      const valueH = doc.heightOfString(valueText, { width });
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(MID_GREY)
        .text(s(name).toUpperCase(), x, y, { width, characterSpacing: 0.3 });
      doc.fontSize(10).font('Helvetica').fillColor(TEXT)
        .text(valueText, x, y + labelH + 2, { width });
      return labelH + valueH + 2;
    }

    // Two fields side by side, which is how a details block reads on paper.
    // A row is measured before anything is drawn so it never straddles a page
    // break with its label on one page and its value on the next.
    function pair(leftName, leftValue, rightName, rightValue) {
      const gap = 18;
      const w = (CONTENT_W - gap) / 2;
      const measure = (name, value) => {
        doc.fontSize(7.5).font('Helvetica-Bold');
        const lh = doc.heightOfString(s(name), { width: w });
        doc.fontSize(10).font('Helvetica');
        return lh + 2 + doc.heightOfString(s(value) || '—', { width: w });
      };
      const needed = Math.max(measure(leftName, leftValue),
        rightName ? measure(rightName, rightValue) : 0);
      space(needed + 12);
      fieldAt(MARGIN, w, leftName, leftValue);
      if (rightName) fieldAt(MARGIN + w + gap, w, rightName, rightValue);
      y += needed + 12;
    }

    function wide(name, value) {
      const valueText = s(value) || '—';
      doc.fontSize(7.5).font('Helvetica-Bold');
      const labelH = doc.heightOfString(s(name), { width: CONTENT_W });
      doc.fontSize(10).font('Helvetica');
      const valueH = doc.heightOfString(valueText, { width: CONTENT_W });
      space(labelH + valueH + 14);
      fieldAt(MARGIN, CONTENT_W, name, value);
      y += labelH + valueH + 14;
    }

    function note(text) {
      const t = s(text);
      doc.fontSize(8.5).font('Helvetica-Oblique');
      const h = doc.heightOfString(t, { width: CONTENT_W });
      space(h + 8);
      doc.fillColor(MID_GREY).text(t, MARGIN, y, { width: CONTENT_W });
      doc.fillColor(TEXT);
      y += h + 8;
    }

    // ── Letterhead ────────────────────────────────────────────────────
    if (theme.logoBase64) {
      try {
        const base64 = String(theme.logoBase64).replace(/^data:[^;]+;base64,/, '');
        doc.image(Buffer.from(base64, 'base64'), MARGIN, y, { fit: [150, 46] });
      } catch { /* a bad logo must not stop the form printing */ }
    }
    doc.fontSize(9).font('Helvetica').fillColor(MID_GREY)
      .text(s(theme.companyName), MARGIN + 160, y + 4, { width: CONTENT_W - 160, align: 'right' });
    if (theme.contactDetails) {
      doc.fontSize(8).text(s(theme.contactDetails), MARGIN + 160, y + 18,
        { width: CONTENT_W - 160, align: 'right' });
    }
    y += 62;

    doc.fontSize(20).font('Helvetica-Bold').fillColor(TEXT)
      .text('Job Form', MARGIN, y, { width: CONTENT_W });
    y += 26;

    const heading = [job.ref, job.customer_name, job.site_address || job.job_site_address]
      .filter(Boolean).map(s).join('  ·  ');
    if (heading) {
      doc.fontSize(10).font('Helvetica').fillColor(MID_GREY);
      const h = doc.heightOfString(heading, { width: CONTENT_W });
      doc.text(heading, MARGIN, y, { width: CONTENT_W });
      y += h + 6;
    }

    const issued = [
      `Issued ${dateLabel(new Date())}`,
      issuedBy ? `by ${s(issuedBy)}` : '',
      issuedTo ? `for ${s(issuedTo)}` : '',
    ].filter(Boolean).join(' ');
    doc.fontSize(8.5).font('Helvetica').fillColor(MID_GREY).text(issued, MARGIN, y, { width: CONTENT_W });
    y += 16;

    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor(RULE).lineWidth(1).stroke();
    y += 10;

    // Said plainly and near the top, because the alternative is a subbie
    // hunting for a figure that was never there.
    note('This form carries the site and scope information only. Prices, quote '
      + 'references, terms of sale and payment terms are deliberately left out.');

    if (message) {
      const text = s(message);
      doc.fontSize(9.5).font('Helvetica');
      const h = doc.heightOfString(text, { width: CONTENT_W - 20 });
      space(h + 22);
      doc.rect(MARGIN, y, CONTENT_W, h + 16).fill(SOFT);
      doc.fillColor(TEXT).text(text, MARGIN + 10, y + 8, { width: CONTENT_W - 20 });
      y += h + 24;
    }

    // ── Customer ──────────────────────────────────────────────────────
    section('Customer');
    pair('Customer', job.customer_name, 'Company', job.customer_company);
    pair('Contact', job.customer_contact_name, 'Phone', job.customer_phone);
    pair('Mobile', job.customer_mobile, 'Email', job.customer_email);
    if (job.customer_postal) wide('Postal address', job.customer_postal);

    // ── Site ──────────────────────────────────────────────────────────
    section('Site');
    wide('Site address', job.site_address || job.job_site_address);
    if (job.site_label) wide('Site', job.site_label);
    pair('Site contact', job.job_contact, 'Site contact phone',
      job.job_contact_mobile || job.job_contact_phone);

    // ── The job ───────────────────────────────────────────────────────
    section('The job');
    pair('Job', job.ref, 'Type', label(job.type));
    pair('Status', label(job.status), 'Priority', label(job.priority));
    pair('Due', dateLabel(job.due_date),
      'Lead', [job.lead_tech_name, job.lead_tech_mobile].filter(Boolean).join(' · '));
    if (team.length) {
      wide('Team on this job',
        team.map(t => [t.name, t.mobile].filter(Boolean).join(' · ')).join('\n'));
    }
    if (job.description) wide('Job description', job.description);
    if (job.materials) wide('Materials noted on the job', job.materials);

    // ── Scope of works, off the accepted quote ────────────────────────
    section('Scope of works');
    if (!quote) {
      note('No quote on this job has been accepted yet, so there is no agreed '
        + 'scope to copy in. The job description above is what is on file.');
    } else {
      const accepted = [
        quote.accepted_name ? `Accepted by ${s(quote.accepted_name)}` : 'Accepted',
        quote.accepted_at ? `on ${dateLabel(quote.accepted_at)}` : '',
      ].filter(Boolean).join(' ');
      doc.fontSize(9).font('Helvetica-Bold').fillColor(MID_GREY);
      space(16);
      doc.text(accepted, MARGIN, y, { width: CONTENT_W });
      y += 16;
      doc.fillColor(TEXT);
      if (quote.accepted_count > 1) {
        note(`${quote.accepted_count} quotes on this job have been accepted — this is `
          + 'the most recent. Check with the office if work from an earlier one is also outstanding.');
      }

      if (quote.notes) {
        if (isHtml(quote.notes)) {
          y = renderDescriptionHtml(doc, quote.notes, MARGIN, y, CONTENT_W, ensureSpace, { baseSize: 9.5 });
        } else {
          const text = s(quote.notes);
          doc.fontSize(9.5).font('Helvetica').fillColor(TEXT);
          const h = doc.heightOfString(text, { width: CONTENT_W });
          space(h + 6);
          doc.text(text, MARGIN, y, { width: CONTENT_W });
          y += h + 6;
        }
      } else {
        note('The accepted quote has no written description on it.');
      }

      if (includeWorks && works.length) {
        y += 6;
        section('What is being supplied and installed');
        note('Quantities only. What any of it costs is not part of this form.');
        const qtyW = 60;
        const descW = CONTENT_W - qtyW;
        space(18);
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor(MID_GREY)
          .text('DESCRIPTION', MARGIN, y, { width: descW })
          .text('QTY', MARGIN + descW, y, { width: qtyW, align: 'right' });
        y += 12;
        doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor(RULE).lineWidth(0.5).stroke();
        y += 6;
        for (const w of works) {
          const text = s(w.description);
          doc.fontSize(9.5).font('Helvetica');
          const h = doc.heightOfString(text, { width: descW - 8 });
          space(h + 8);
          doc.fillColor(TEXT).text(text, MARGIN, y, { width: descW - 8 });
          doc.text(String(w.quantity), MARGIN + descW, y, { width: qtyW, align: 'right' });
          y += h + 6;
          doc.moveTo(MARGIN, y - 2).lineTo(MARGIN + CONTENT_W, y - 2)
            .strokeColor(RULE).lineWidth(0.5).stroke();
          y += 2;
        }
        y += 6;
      }
    }

    // ── The diary ─────────────────────────────────────────────────────
    section('Scheduled in the diary');
    if (!days.length) {
      note('Nobody is booked on this job yet. Nothing has been put in the diary for it.');
    } else {
      for (const day of days) {
        const title = dayLabel(day.date);
        doc.fontSize(10).font('Helvetica-Bold');
        const titleH = doc.heightOfString(title, { width: CONTENT_W });
        // The day heading and its first booking stay together: a heading alone
        // at the foot of a page reads as a day with nobody on it.
        space(titleH + 26);
        doc.fillColor(TEXT).text(title, MARGIN, y, { width: CONTENT_W });
        y += titleH + 4;

        for (const b of day.people) {
          const who = [s(b.person), b.mobile ? s(b.mobile) : ''].filter(Boolean).join('  ·  ');
          const when = timeRange(b);
          const tag = b.appointment_type && b.appointment_type !== 'operations'
            ? `  (${label(b.appointment_type)} diary)` : '';
          doc.fontSize(9.5).font('Helvetica');
          const line = `${when}   ${who}${tag}`;
          const h = doc.heightOfString(line, { width: CONTENT_W - 12 });
          space(h + 6);
          doc.fillColor(TEXT).font('Helvetica-Bold').text(when, MARGIN + 6, y, { width: 110 });
          doc.font('Helvetica').fillColor(TEXT)
            .text(`${who}${tag}`, MARGIN + 120, y, { width: CONTENT_W - 120 });
          y += Math.max(h, 13) + 3;
          if (b.notes) {
            const n = s(b.notes);
            doc.fontSize(8.5).font('Helvetica-Oblique').fillColor(MID_GREY);
            const nh = doc.heightOfString(n, { width: CONTENT_W - 126 });
            space(nh + 4);
            doc.text(n, MARGIN + 120, y, { width: CONTENT_W - 126 });
            y += nh + 4;
            doc.fillColor(TEXT);
          }
        }
        y += 8;
      }
    }

    // ── What is attached behind this ──────────────────────────────────
    if (attachments.length) {
      section('Attached to this form');
      note(`${attachments.length} file${attachments.length === 1 ? '' : 's'} from the job's `
        + 'Pre-Install Forms tab follow on the pages after this.');
      for (const a of attachments) {
        // A file nobody could open is named here anyway. Leaving it off is how
        // a subbie works from a plan that was never in the document.
        const bits = skipped.includes(a.filename)
          ? 'Could not be read'
          : [a.is_drawing ? 'Drawing' : (a.kind === 'pdf' ? 'PDF' : 'Photo'),
            fileSize(a.size_bytes)].filter(Boolean).join(' · ');
        const line = `${s(a.filename)}`;
        doc.fontSize(9.5).font('Helvetica');
        const h = doc.heightOfString(line, { width: CONTENT_W - 110 });
        space(h + 6);
        doc.fillColor(TEXT).text(line, MARGIN + 6, y, { width: CONTENT_W - 116 });
        doc.fontSize(8.5).fillColor(MID_GREY)
          .text(bits, MARGIN + CONTENT_W - 110, y + 1, { width: 110, align: 'right' });
        y += h + 5;
      }
    } else {
      section('Attached to this form');
      note('There are no photos, plans or PDFs on the job’s Pre-Install Forms tab, '
        + 'so nothing is attached behind this.');
    }

    // ── The photos and plans themselves, one to a page ────────────────
    for (const img of images) {
      doc.addPage();
      doc.fontSize(9).font('Helvetica-Bold').fillColor(MID_GREY)
        .text(s(img.filename), MARGIN, MARGIN, { width: CONTENT_W, ellipsis: true });
      const top = MARGIN + 18;
      const boxH = PAGE_H - top - MARGIN - 18;
      try {
        doc.image(img.buffer, MARGIN, top, {
          fit: [CONTENT_W, boxH], align: 'center', valign: 'center',
        });
      } catch {
        // One picture pdfkit cannot read must not cost the whole document, and
        // a visible placeholder is better than a page that silently went blank.
        doc.rect(MARGIN, top, CONTENT_W, boxH).strokeColor(RULE).lineWidth(1).stroke();
        doc.fontSize(10).font('Helvetica').fillColor(MID_GREY)
          .text('This file could not be included — open it in the app instead.',
            MARGIN, top + boxH / 2 - 6, { width: CONTENT_W, align: 'center' });
      }
    }

    // ── Page footers, written once every page exists ──────────────────
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      // The footer sits below the bottom margin on purpose, and pdfkit adds a
      // page whenever text is written past it — which turned a two-page form
      // into six, four of them blank, each one footed in turn. Dropping the
      // margin for the write is how pdfkit itself says to do a footer.
      doc.page.margins.bottom = 0;
      const footY = PAGE_H - MARGIN + 8;
      doc.moveTo(MARGIN, footY - 8).lineTo(MARGIN + CONTENT_W, footY - 8)
        .strokeColor(RULE).lineWidth(0.5).stroke();
      doc.fontSize(7.5).font('Helvetica').fillColor(MID_GREY)
        .text([s(theme.companyName), 'Job Form', s(job.ref)].filter(Boolean).join('  ·  '),
          MARGIN, footY, { width: CONTENT_W / 2, lineBreak: false })
        .text(`Page ${i + 1} of ${range.count}`,
          MARGIN + CONTENT_W / 2, footY, { width: CONTENT_W / 2, align: 'right', lineBreak: false });
    }
    doc.flushPages();
    doc.end();
  });

  if (!pdfs.length) return mainBuf;

  // Whole PDFs off the job — plans, consents, spec sheets — spliced on the end
  // rather than redrawn, so a multi-page council form arrives intact.
  const merged = await PdfLib.load(mainBuf);
  for (const f of pdfs) {
    try {
      const doc = await PdfLib.load(f.buffer);
      const copied = await merged.copyPages(doc, doc.getPageIndices());
      copied.forEach(p => merged.addPage(p));
    } catch (err) {
      console.error(`Could not merge "${f.filename}" into the job form:`, err.message);
    }
  }
  return Buffer.from(await merged.save());
}

module.exports = { buildJobPackPDF };
