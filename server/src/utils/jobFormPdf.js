const PDFDocument = require('pdfkit');

// A PDF of any form built in the Form Builder, rendered from the submission's
// own field snapshot so it prints the questions as they were when it was filled
// in — not as the template reads today.
//
// The Electrical COC keeps its own builder: it is a statutory certificate with
// a prescribed set of fields, and nothing here knows about those.

const TEXT = '#0f172a';
const MID_GREY = '#64748b';
const RULE = '#e2e8f0';

const MARGIN = 50;
const PAGE_W = 595.28; // A4 pt
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
}

// pdfkit's standard fonts use WinAnsiEncoding, which has no glyphs for the
// macron vowels common in NZ place names — left in they corrupt the rest of the
// line, so fold to plain ASCII. Same reasoning as the COC builder.
const COMBINING_MARKS_RE = new RegExp('[\\u0300-\\u036f]', 'g');
function stripDiacritics(value) {
  if (value == null) return value;
  return String(value).normalize('NFD').replace(COMBINING_MARKS_RE, '');
}

// One answer, as it should read on paper. The value shapes come from the field
// types in client/src/pages/settings/formFields.js.
function answerText(field, value) {
  if (value === undefined || value === null || value === '') return '—';
  switch (field.type) {
    case 'checkbox':
      return value === true ? `Yes — ${field.checkboxText || 'Confirmed'}` : 'No';
    case 'date':
      return formatDate(value);
    case 'signoff': {
      const parts = [];
      if (value.name) parts.push(value.name);
      if (value.date) parts.push(formatDate(value.date));
      return parts.length ? parts.join(' · ') : '—';
    }
    case 'photo':
      // Rendered as pictures further down, not as text.
      return '';
    default:
      return String(value);
  }
}

async function buildJobFormPDF({ job, submission, theme = {}, photos = {} }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = MARGIN;

    function ensureSpace(needed) {
      if (y + needed > PAGE_H - MARGIN) {
        doc.addPage();
        y = MARGIN;
      }
    }

    function sectionHeader(title, help) {
      ensureSpace(34);
      doc.rect(MARGIN, y, CONTENT_W, 20).fill(theme.brandColour || '#1e40af');
      doc.fillColor('white').fontSize(10).font('Helvetica-Bold')
        .text(stripDiacritics(title) || '', MARGIN + 8, y + 5, { width: CONTENT_W - 16, lineBreak: false, ellipsis: true });
      doc.fillColor(TEXT);
      y += 26;
      if (help) {
        const text = stripDiacritics(help);
        const h = doc.fontSize(8.5).font('Helvetica').heightOfString(text, { width: CONTENT_W });
        ensureSpace(h + 6);
        doc.fillColor(MID_GREY).text(text, MARGIN, y, { width: CONTENT_W });
        y += h + 6;
        doc.fillColor(TEXT);
      }
      y += 4;
    }

    function field(label, value) {
      const labelText = stripDiacritics(label) || '';
      const valueText = stripDiacritics(value) || '—';
      doc.fontSize(8).font('Helvetica-Bold');
      const labelH = doc.heightOfString(labelText, { width: CONTENT_W });
      doc.fontSize(10).font('Helvetica');
      const valueH = doc.heightOfString(valueText, { width: CONTENT_W });
      ensureSpace(labelH + valueH + 12);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(MID_GREY).text(labelText, MARGIN, y, { width: CONTENT_W });
      y += labelH + 2;
      doc.fontSize(10).font('Helvetica').fillColor(TEXT).text(valueText, MARGIN, y, { width: CONTENT_W });
      y += valueH + 10;
    }

    // Two to a row, so a form that is mostly photos doesn't run to many pages.
    function photoGrid(label, items) {
      // Still print the question when nothing was taken — a silently missing
      // field reads as though it was never asked.
      if (!items.length) return field(label, 'No photos');
      const labelText = stripDiacritics(label) || '';
      doc.fontSize(8).font('Helvetica-Bold');
      const labelH = doc.heightOfString(labelText, { width: CONTENT_W });
      ensureSpace(labelH + 12);
      doc.fillColor(MID_GREY).text(labelText, MARGIN, y, { width: CONTENT_W });
      y += labelH + 6;
      doc.fillColor(TEXT);

      const gap = 12;
      const w = (CONTENT_W - gap) / 2;
      const h = w * 0.75;
      for (let i = 0; i < items.length; i += 2) {
        ensureSpace(h + gap);
        for (let col = 0; col < 2; col++) {
          const buffer = items[i + col];
          if (!buffer) break;
          const x = MARGIN + col * (w + gap);
          try {
            doc.image(buffer, x, y, { fit: [w, h], align: 'center', valign: 'center' });
          } catch {
            // A photo that pdfkit can't read (an unexpected format, a truncated
            // upload) leaves a placeholder rather than failing the whole PDF.
            doc.rect(x, y, w, h).strokeColor(RULE).lineWidth(1).stroke();
            doc.fontSize(8).fillColor(MID_GREY)
              .text('Photo could not be included', x, y + h / 2 - 4, { width: w, align: 'center' });
            doc.fillColor(TEXT);
          }
        }
        y += h + gap;
      }
    }

    // ── Letterhead ──
    if (theme.logoBase64) {
      try {
        const base64 = String(theme.logoBase64).replace(/^data:[^;]+;base64,/, '');
        doc.image(Buffer.from(base64, 'base64'), MARGIN, y, { fit: [150, 46] });
      } catch { /* a bad logo must not stop the form printing */ }
    }
    doc.fontSize(9).font('Helvetica').fillColor(MID_GREY)
      .text(stripDiacritics(theme.companyName) || '', MARGIN + 160, y + 4, { width: CONTENT_W - 160, align: 'right' });
    if (theme.contactDetails) {
      doc.fontSize(8).text(stripDiacritics(theme.contactDetails), MARGIN + 160, y + 18, {
        width: CONTENT_W - 160, align: 'right',
      });
    }
    y += 62;

    doc.fontSize(16).font('Helvetica-Bold').fillColor(TEXT)
      .text(stripDiacritics(submission.name) || 'Form', MARGIN, y, { width: CONTENT_W });
    y += doc.heightOfString(submission.name || 'Form', { width: CONTENT_W }) + 4;

    const meta = [
      job?.job_number != null || job?.external_ref
        ? `Job ${job.external_ref || 'JB' + String(job.job_number).padStart(5, '0')}`
        : null,
      job?.customer_name ? stripDiacritics(job.customer_name) : null,
      job?.site_address ? stripDiacritics(job.site_address) : null,
    ].filter(Boolean).join('  ·  ');
    if (meta) {
      doc.fontSize(9).font('Helvetica').fillColor(MID_GREY).text(meta, MARGIN, y, { width: CONTENT_W });
      y += doc.heightOfString(meta, { width: CONTENT_W }) + 4;
    }

    const status = submission.status === 'completed'
      ? `Completed${submission.completed_by_name ? ` by ${stripDiacritics(submission.completed_by_name)}` : ''}` +
        `${submission.completed_at ? ` on ${formatDate(submission.completed_at)}` : ''}`
      : 'In progress — not yet completed';
    doc.fontSize(9).fillColor(submission.status === 'completed' ? MID_GREY : '#b45309').text(status, MARGIN, y);
    y += 18;

    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor(RULE).lineWidth(1).stroke();
    y += 14;
    doc.fillColor(TEXT);

    // ── The form itself ──
    const fields = submission.fields_snapshot || [];
    const answers = submission.answers || {};
    if (!fields.length) {
      doc.fontSize(10).font('Helvetica').fillColor(MID_GREY).text('This form has no fields.', MARGIN, y);
    }
    for (const f of fields) {
      if (f.type === 'section') { sectionHeader(f.label, f.help); continue; }
      if (f.type === 'photo') { photoGrid(f.label, photos[f.id] || []); continue; }
      field(f.label, answerText(f, answers[f.id]));
    }

    doc.end();
  });
}

module.exports = { buildJobFormPDF };
