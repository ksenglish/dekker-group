// The Job Form as a printed document.
//
// Laid out the way the job service report is — the theme's letterhead, the
// document type and job number, then the three-column block of customer, job
// and who it was prepared for — so a subbie holding this and a customer
// holding a quote are holding two documents from one company.
//
// Where the service report has labour, materials and totals, this has the
// job's pre-install photos and plans, then the days and times the diary has
// somebody booked. There is no money anywhere in it, and it says so, because
// the alternative is a subbie hunting for a page that was never there.
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

// The same three sizes the quote letterhead offers, so a theme set up for
// quotes prints its logo at the size it was set up at.
const LOGO_HEIGHTS = { small: 36, medium: 58, large: 78 };

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
function dayParts(value) {
  if (!value) return null;
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
}
const dayLabel = v => {
  const d = dayParts(v);
  return d ? d.toLocaleDateString('en-NZ', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }) : '';
};
// A business where the work is is not the same day as a server in UTC, and
// "Issued 14 Nov" on a form printed on the 15th is the kind of small wrongness
// a subbie notices. So an instant is read in the business zone, while a DATE
// column — which is already a calendar day and has no zone — is read off its
// own parts.
const ZONE = process.env.BUSINESS_TIMEZONE || 'Pacific/Auckland';
const fullDate = v => {
  if (!v) return '';
  const asString = v instanceof Date ? v.toISOString() : String(v);
  if (asString.length > 10) {
    return new Date(asString).toLocaleDateString('en-NZ', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: ZONE,
    });
  }
  const d = dayParts(v);
  return d ? d.toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }) : '';
};

function timeRange(b) {
  if (!b.start_time && !b.end_time) return 'Time not set';
  if (!b.end_time) return `From ${b.start_time}`;
  if (!b.start_time) return `Until ${b.end_time}`;
  return `${b.start_time} - ${b.end_time}`;
}

const s = v => stripDiacritics(v == null ? '' : String(v));

function fileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function buildJobFormPDF({ report, images = [], pdfs = [], skipped = [] }) {
  const { job, customer, company, quote, works, schedule, files } = report;
  const brand = company?.brandColour || '#1e40af';
  const theme = report._theme || {};

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

    // ── Letterhead ────────────────────────────────────────────────────
    // Logo and contact details sit wherever the theme puts them, the same way
    // the quote builder places them.
    const logoLeft = (company?.logoPosition || 'left') === 'left';
    const contactLeft = (company?.contactPosition || 'right') === 'left';
    const logoH = LOGO_HEIGHTS[company?.logoSize] || LOGO_HEIGHTS.medium;
    const halfW = (CONTENT_W - 20) / 2;
    const logoX = logoLeft ? MARGIN : MARGIN + halfW + 20;
    const contactX = contactLeft ? MARGIN : MARGIN + halfW + 20;

    let drew = false;
    if (company?.logo) {
      try {
        const base64 = String(company.logo).replace(/^data:[^;]+;base64,/, '');
        doc.image(Buffer.from(base64, 'base64'), logoX, y, { fit: [halfW, logoH] });
        drew = true;
      } catch { /* a bad logo must not stop the form printing */ }
    }
    if (!drew) {
      doc.fontSize(16).font('Helvetica-Bold').fillColor(TEXT)
        .text(s(company?.name), logoX, y + 6, { width: halfW, align: logoLeft ? 'left' : 'right' });
    }
    if (company?.contactDetails) {
      doc.fontSize(8.5).font('Helvetica').fillColor(MID_GREY)
        .text(s(company.contactDetails), contactX, y + 2,
          { width: halfW, align: contactLeft ? 'left' : 'right' });
    }
    y += Math.max(logoH, 52) + 12;

    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor(brand).lineWidth(2).stroke();
    y += 14;

    // ── Title row ─────────────────────────────────────────────────────
    doc.fontSize(11).font('Helvetica-Bold').fillColor(brand)
      .text('JOB FORM', MARGIN, y + 6, { width: CONTENT_W / 2, characterSpacing: 1.2 });
    doc.fontSize(20).font('Helvetica-Bold').fillColor(TEXT)
      .text(s(job.number), MARGIN + CONTENT_W / 2, y, { width: CONTENT_W / 2, align: 'right' });
    y += 34;

    // ── Customer · Job · Prepared for ─────────────────────────────────
    const colW = (CONTENT_W - 28) / 3;
    const colX = i => MARGIN + i * (colW + 14);

    function fieldBlock(x, name, value, startY) {
      if (!value) return 0;
      doc.fontSize(7).font('Helvetica-Bold').fillColor(MID_GREY)
        .text(s(name).toUpperCase(), x, startY, { width: colW, characterSpacing: 0.4 });
      const h = doc.fontSize(9.5).font('Helvetica').heightOfString(s(value), { width: colW });
      doc.fillColor(TEXT).text(s(value), x, startY + 10, { width: colW });
      return h + 10 + 7;
    }

    // Column one is the customer, written the way a Bill To block is.
    let y0 = y;
    doc.fontSize(7).font('Helvetica-Bold').fillColor(MID_GREY)
      .text('CUSTOMER', colX(0), y0, { width: colW, characterSpacing: 0.4 });
    y0 += 11;
    const custName = customer.company || customer.name;
    if (custName) {
      doc.fontSize(11).font('Helvetica-Bold').fillColor(TEXT)
        .text(s(custName), colX(0), y0, { width: colW });
      y0 += doc.heightOfString(s(custName), { width: colW }) + 1;
    }
    const custLines = [
      customer.company && customer.name ? customer.name : null,
      customer.contact_name && customer.contact_name !== customer.name ? `Attn: ${customer.contact_name}` : null,
      customer.address, customer.email, customer.phone,
    ].filter(Boolean);
    doc.fontSize(9).font('Helvetica').fillColor(MID_GREY);
    for (const line of custLines) {
      doc.text(s(line), colX(0), y0, { width: colW });
      y0 += doc.heightOfString(s(line), { width: colW }) + 1;
    }

    // Column two is the job.
    let y1 = y;
    y1 += fieldBlock(colX(1), 'Job number', job.number, y1);
    y1 += fieldBlock(colX(1), 'Job address', job.address, y1);
    y1 += fieldBlock(colX(1), 'Site contact',
      [job.contact, job.contact_phone].filter(Boolean).join(' · '), y1);

    // Column three is who it is for and when it was drawn up.
    let y2 = y;
    y2 += fieldBlock(colX(2), 'Prepared for', report.prepared_for, y2);
    y2 += fieldBlock(colX(2), 'Issued', fullDate(report.generated_at), y2);
    y2 += fieldBlock(colX(2), 'On site', job.due_date ? fullDate(job.due_date) : '', y2);
    y2 += fieldBlock(colX(2), 'Lead', job.lead, y2);

    y = Math.max(y0, y1, y2) + 12;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor(RULE).lineWidth(1).stroke();
    y += 14;

    // Said plainly and near the top, so nobody goes looking.
    function note(text, colour = MID_GREY) {
      const t = s(text);
      doc.fontSize(8.5).font('Helvetica-Oblique');
      const h = doc.heightOfString(t, { width: CONTENT_W });
      space(h + 8);
      doc.fillColor(colour).text(t, MARGIN, y, { width: CONTENT_W });
      doc.fillColor(TEXT);
      y += h + 8;
    }

    function section(title) {
      space(30);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(TEXT)
        .text(s(title), MARGIN, y, { width: CONTENT_W });
      y += 15;
      doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor(RULE).lineWidth(1).stroke();
      y += 10;
    }

    if (report.message) {
      const text = s(report.message);
      doc.fontSize(9.5).font('Helvetica');
      const h = doc.heightOfString(text, { width: CONTENT_W - 20 });
      space(h + 24);
      doc.rect(MARGIN, y, CONTENT_W, h + 16).fill(SOFT);
      doc.fillColor(TEXT).font('Helvetica').text(text, MARGIN + 10, y + 8, { width: CONTENT_W - 20 });
      y += h + 26;
    }

    // ── Scope of works ────────────────────────────────────────────────
    section('Scope of works');
    if (!job.scope) {
      note('No quote on this job has been accepted and the job has no description, '
        + 'so there is no agreed scope to copy in.');
    } else {
      if (job.scope_source === 'quote' && quote) {
        const accepted = [
          quote.accepted_name ? `Accepted by ${s(quote.accepted_name)}` : 'Accepted',
          quote.accepted_at ? `on ${fullDate(quote.accepted_at)}` : '',
        ].filter(Boolean).join(' ');
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor(MID_GREY);
        space(14);
        doc.text(accepted, MARGIN, y, { width: CONTENT_W });
        y += 14;
        doc.fillColor(TEXT);
        if (quote.accepted_count > 1) {
          note(`${quote.accepted_count} quotes on this job have been accepted - this is the `
            + 'most recent. Check with the office if work from an earlier one is also outstanding.');
        }
      } else {
        note('From the job description. No quote on this job has been accepted yet.');
      }

      if (isHtml(job.scope)) {
        y = renderDescriptionHtml(doc, job.scope, MARGIN, y, CONTENT_W, ensureSpace, { baseSize: 9.5 });
      } else {
        const text = s(job.scope);
        doc.fontSize(9.5).font('Helvetica').fillColor(TEXT);
        const h = doc.heightOfString(text, { width: CONTENT_W });
        space(h + 6);
        doc.text(text, MARGIN, y, { width: CONTENT_W });
        y += h + 6;
      }
    }

    if (works.length) {
      y += 6;
      space(20);
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(MID_GREY)
        .text('SUPPLIED AND INSTALLED', MARGIN, y, { width: CONTENT_W - 60 })
        .text('QTY', MARGIN + CONTENT_W - 60, y, { width: 60, align: 'right' });
      y += 11;
      doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor(RULE).lineWidth(0.5).stroke();
      y += 6;
      for (const w of works) {
        const text = s(w.description);
        doc.fontSize(9.5).font('Helvetica');
        const h = doc.heightOfString(text, { width: CONTENT_W - 70 });
        space(h + 8);
        doc.fillColor(TEXT).text(text, MARGIN, y, { width: CONTENT_W - 70 });
        doc.text(String(w.quantity), MARGIN + CONTENT_W - 60, y, { width: 60, align: 'right' });
        y += h + 6;
        doc.moveTo(MARGIN, y - 2).lineTo(MARGIN + CONTENT_W, y - 2)
          .strokeColor(RULE).lineWidth(0.5).stroke();
        y += 2;
      }
      note('Quantities only. What any of it costs is not part of this form.');
    }
    y += 8;

    // ── Pre-install photos and plans ──────────────────────────────────
    section('Pre-install photos and plans');
    if (!files.length) {
      note('Nothing from the job’s Pre-Install Forms tab is on this copy.');
    } else {
      note(`${files.length} file${files.length === 1 ? '' : 's'} follow on the pages after this.`);
      for (const f of files) {
        // A file nobody could open is named here anyway. Leaving it off is how
        // a subbie works from a plan that was never in the document.
        const bits = skipped.includes(f.filename)
          ? 'Could not be read'
          : [f.is_drawing ? 'Drawing' : (f.kind === 'pdf' ? 'PDF' : 'Photo'),
            fileSize(f.size_bytes)].filter(Boolean).join(' · ');
        doc.fontSize(9.5).font('Helvetica');
        const h = doc.heightOfString(s(f.filename), { width: CONTENT_W - 116 });
        space(h + 6);
        doc.fillColor(TEXT).text(s(f.filename), MARGIN + 6, y, { width: CONTENT_W - 116 });
        doc.fontSize(8.5).fillColor(MID_GREY)
          .text(bits, MARGIN + CONTENT_W - 110, y + 1, { width: 110, align: 'right' });
        y += h + 5;
      }
    }
    y += 8;

    // ── Scheduled dates and times ─────────────────────────────────────
    section('Scheduled dates and times');
    if (!schedule.length) {
      note('No days from the diary are on this copy.');
    } else {
      space(18);
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(MID_GREY)
        .text('TEAM MEMBER', MARGIN, y, { width: 170 })
        .text('DATE', MARGIN + 176, y, { width: 150 })
        .text('TIMES', MARGIN + 332, y, { width: CONTENT_W - 332, align: 'right' });
      y += 11;
      doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor(RULE).lineWidth(0.5).stroke();
      y += 6;

      for (const b of schedule) {
        const who = s(b.person) + (b.mobile ? `  ${s(b.mobile)}` : '');
        doc.fontSize(9.5).font('Helvetica');
        const h = Math.max(
          doc.heightOfString(who, { width: 170 }),
          doc.heightOfString(dayLabel(b.date), { width: 150 })
        );
        space(h + 10);
        doc.fillColor(TEXT).font('Helvetica-Bold').text(s(b.person), MARGIN, y, { width: 170 });
        doc.font('Helvetica').fillColor(TEXT)
          .text(dayLabel(b.date), MARGIN + 176, y, { width: 150 })
          .text(timeRange(b), MARGIN + 332, y, { width: CONTENT_W - 332, align: 'right' });
        y += h + 2;
        const extras = [
          b.mobile ? s(b.mobile) : null,
          b.appointment_type && b.appointment_type !== 'operations'
            ? `${label(b.appointment_type)} diary` : null,
          b.notes ? s(b.notes) : null,
        ].filter(Boolean).join('  ·  ');
        if (extras) {
          doc.fontSize(8.5).font('Helvetica').fillColor(MID_GREY);
          const eh = doc.heightOfString(extras, { width: CONTENT_W });
          space(eh + 4);
          doc.text(extras, MARGIN, y, { width: CONTENT_W });
          y += eh + 2;
          doc.fillColor(TEXT);
        }
        y += 6;
        doc.moveTo(MARGIN, y - 3).lineTo(MARGIN + CONTENT_W, y - 3)
          .strokeColor(RULE).lineWidth(0.5).stroke();
      }
    }
    y += 10;

    note('This form carries site and scope information only. Prices, quote references, '
      + 'terms of sale and payment terms are deliberately left out.');

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
        // a visible placeholder beats a page that silently went blank.
        doc.rect(MARGIN, top, CONTENT_W, boxH).strokeColor(RULE).lineWidth(1).stroke();
        doc.fontSize(10).font('Helvetica').fillColor(MID_GREY)
          .text('This file could not be included - open it in the app instead.',
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
      const left = [s(theme.footerLine1) || s(company?.name), 'Job Form', s(job.number)]
        .filter(Boolean).join('  ·  ');
      doc.fontSize(7.5).font('Helvetica').fillColor(MID_GREY)
        .text(left, MARGIN, footY, { width: CONTENT_W / 2, lineBreak: false })
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

module.exports = { buildJobFormPDF };
